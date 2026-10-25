import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PassThrough, type Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { AppConfig, MediaItem, OutputMode, ScheduleEntry } from './types.js';
import { LkpDatabase } from './database.js';
import { writeEpgAtomic } from './epg.js';
import { ensureSchedule } from './schedule.js';
import { prepareLogo, type PreparedLogo } from './logo.js';
import { channelEntryAllowed, loadStationConfig, profileConfig, profileWindow } from './channels.js';
import { stationAssets } from './channel-schedule.js';
import { locatePlayoutPosition } from './editorial.js';
import { TransportPacer } from './transport.js';
import { writePlayoutStatus, type PlayoutStatus } from './playout-status.js';
import { recoveryIntermission } from './continuity.js';
import { readRotationLibrary, type RotationClip } from './intermissions/rotation.js';
import { comingUpFilter, comingUpForPiece, type ComingUpOverlay } from './coming-up.js';
import { preparedSubtitleTracks, dvbLanguage } from './subtitles.js';

export interface BroadcastOptions {
  dryRun: boolean;
  once: boolean;
  output?: string;
  rfAcknowledged: boolean;
  verbose: boolean;
  maxSeconds?: number;
  pastOffsetMs?: number;
  mode?: OutputMode;
}

function log(level: string, message: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`);
}

async function waitUntil(deadlineMs: number, stopped = () => false): Promise<void> {
  while (!stopped() && Date.now() < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadlineMs - Date.now())));
  }
}

function seconds(ms: number): string { return (Math.max(0, ms) / 1000).toFixed(3); }

export function buildFfmpegArgs(
  entry: ScheduleEntry, media: MediaItem | undefined, seekMs: number, remainingMs: number,
  animate: boolean, config: AppConfig, logo: PreparedLogo, outputOffsetMs = seekMs,
  comingUp?: ComingUpOverlay,
): string[] {
  if (config.station?.enabled) {
    config = profileConfig(config, entry.presentation?.profile ?? profileWindow(entry.startsAtMs, config.station).profile);
    if (entry.presentation?.profile === 'ln') animate = false;
  }
  const intermission = entry.showId === 'lkp-intermissions' || entry.listingVisibility === 'hidden' || (entry.presentation && entry.presentation.kind !== 'programme');
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-filter_complex_threads', String(config.video.filterThreads),
    '-threads', String(config.video.decoderThreads), ...(entry.presentation?.loop ? ['-stream_loop', '-1'] : []), '-ss', seconds(seekMs), '-i', entry.mediaPath];
  if (!intermission) args.push('-threads', '1', '-framerate', String(config.video.fps), '-i', logo.path);
  const prepared = intermission ? [] : preparedSubtitleTracks(entry, media, config);
  const subtitleInput = intermission ? 1 : 2;
  prepared.forEach(track => args.push('-ss', seconds(seekMs), '-i', track.path!));
  const d = config.logo.transitionDurationMs / 1000;
  const eased = `(1-pow(1-min(t/${d}\\,1)\\,3))`;
  const scale = `(1+${config.logo.transitionZoom - 1}*sin(PI*${eased}))`;
  const angle = `if(lt(t\\,${d})\\,2*PI*${config.logo.transitionRotations}*${eased}\\,0)`;
  // The finite in-memory loop ends on an unrotated, normal-size frame.
  // Framesync then holds it; animation filters do no work for the rest of the programme.
  const frames = Math.ceil(d * config.video.fps) + 1;
  const canvas = Math.ceil(Math.hypot(logo.width, logo.height) * config.logo.transitionZoom / 4) * 4;
  const paddingLeft = Math.floor((canvas - logo.width) / 4) * 2;
  const paddingTop = Math.floor((canvas - logo.height) / 4) * 2;
  const bugFilter = animate
    ? `[1:v:0]loop=loop=${frames - 1}:size=1:start=0,setpts=N/(${config.video.fps}*TB),` +
      `format=rgba,` +
      `scale=w='${logo.width}*${scale}':h='${logo.height}*${scale}':eval=frame,` +
      // Rotate's zero-angle fast path can leave pixels outside the source rectangle
      // in its reused output buffer. Supply the entire transparent canvas so the
      // final held frame overwrites every pixel, including the animation's edges.
      `pad=${canvas}:${canvas}:floor((ow-iw)/4)*2:floor((oh-ih)/4)*2:color=black@0:eval=frame,format=rgba,` +
      `rotate=angle='${angle}':ow=${canvas}:oh=${canvas}:c=none,format=rgba,setsar=1,format=yuva420p[bug]`
    : '[1:v:0]format=yuva420p[bug]';
  const videoFilter = [
    `[0:v:0]scale=${config.video.width}:${config.video.height}:force_original_aspect_ratio=decrease,` +
      `pad=${config.video.width}:${config.video.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `fps=${config.video.fps},setsar=1,format=yuv420p[base]`,
    bugFilter,
    `[base][bug]overlay=x=${config.logo.left - (animate ? paddingLeft : 0)}:` +
      `y=${config.logo.top - (animate ? paddingTop : 0)}:` +
      'eval=init:eof_action=repeat:repeatlast=1:format=yuv420[v]',
  ].join(';');
  let filter = intermission ? `[0:v:0]scale=${config.video.width}:${config.video.height}:force_original_aspect_ratio=decrease,pad=${config.video.width}:${config.video.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${config.video.fps},setsar=1,format=yuv420p[v]` : videoFilter;
  if (comingUp && !intermission) {
    const strip = comingUpFilter(comingUp, config, subtitleInput + prepared.length, 'programme');
    args.push(...strip.inputs);
    filter = [filter.replace(/\[v\]$/, '[programme]'), ...strip.filters].join(';');
  }
  args.push('-filter_complex', filter, '-map', '[v]', '-map', '0:a:0?');
  const bitmapTracks = media?.subtitles.filter((subtitle, index, all) => subtitle.kind === 'dvb-bitmap' && subtitle.streamIndex !== undefined &&
    all.findIndex(other => other.kind === 'dvb-bitmap' && other.language === subtitle.language) === index) ?? [];
  bitmapTracks.forEach((track) => args.push('-map', `0:${track.streamIndex}`));
  prepared.forEach((_track, index) => args.push('-map', `${subtitleInput + index}:s:0`));
  args.push(
    '-shortest', '-c:v', config.video.codec, '-preset', config.video.preset, '-pix_fmt', 'yuv420p',
    '-threads', String(config.video.encoderThreads),
    // A two-second VBV buffer permits short video bursts that can outrun
    // the fixed-rate MPEG-TS muxer even with 0.7 s of mux delay. A one-second
    // buffer kept DTS ahead of PCR in the programme segment that reproduced
    // the remaining RF glitches.
    '-b:v', config.video.bitrate, '-maxrate', config.video.bitrate, '-bufsize', config.video.bitrate, '-g', String(config.video.fps * 2),
    '-af', 'apad=packet_size=512', '-c:a', 'mp2', '-b:a', config.video.audioBitrate, '-ar', '48000', '-ac', '2',
    // Programme encoders restart at boundaries. A wall-clock offset keeps the
    // elementary-stream timestamps monotonic for the long-lived HLS remuxer.
    // Keep the value below MPEG-TS's 33-bit clock wrap. The HLS relay corrects
    // the once-daily discontinuity while preserving continuity between shows.
    '-output_ts_offset', (((entry.startsAtMs + outputOffsetMs) / 1000) % 86_400).toFixed(3),
  );
  if (Number.isFinite(remainingMs)) args.push('-t', seconds(remainingMs));
  if (config.video.codec === 'libx264') args.push('-tune', 'zerolatency');
  const subtitles = [...bitmapTracks, ...prepared];
  if (subtitles.length) args.push('-c:s', 'copy');
  subtitles.forEach((track, index) => args.push(`-metadata:s:s:${index}`, `language=${dvbLanguage(track.language)}`, `-disposition:s:${index}`, '0'));
  args.push(
    '-metadata', `service_name=${config.channel.name}`, '-metadata', `service_provider=${config.channel.provider}`,
    '-mpegts_service_id', String(config.channel.serviceId), '-mpegts_transport_stream_id', String(config.channel.transportStreamId),
    '-mpegts_original_network_id', String(config.channel.originalNetworkId), '-mpegts_service_type', 'digital_tv',
    '-mpegts_flags', '+system_b+nit+resend_headers', '-muxrate', String(config.video.muxRate),
    // Zero mux delay can put decoded timestamps behind the PCR at this mux
    // rate. FFmpeg then emits an invalid TS, which TV receivers may play in
    // short slow/fast bursts. Keep the proven timing of the clean RF sample.
    '-muxdelay', '0.7', '-muxpreload', '0.7',
    '-streamid', '0:0x100', '-streamid', '1:0x101',
  );
  const languagePids: Record<string, number> = { cs: 0x120, de: 0x121, en: 0x122, sk: 0x123 };
  subtitles.forEach((track, index) => args.push('-streamid', `${index + 2}:${languagePids[track.language] ?? 0x124 + index}`));
  args.push('-f', 'mpegts', 'pipe:1');
  return args;
}

function spawnLogged(command: string, args: string[], options: SpawnOptions, verbose: boolean): ChildProcess {
  const child = spawn(command, args, options);
  child.on('error', (error) => log('error', `${command} failed to start`, { error: error.message }));
  if (verbose && child.stderr) child.stderr.pipe(process.stderr);
  return child;
}

async function waitFor(child: ChildProcess): Promise<number | null> {
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
}

function stopChild(child: ChildProcess | undefined): void {
  if (child && child.exitCode === null) child.kill('SIGTERM');
}

interface EncoderTarget {
  entry: ScheduleEntry;
  media: MediaItem | undefined;
  seekMs: number;
  outputOffsetMs: number;
  animate: boolean;
  limitMs?: number;
  intermission?: boolean;
  plannedStartsAtMs?: number;
  plannedOffsetMs?: number;
  programme?: ScheduleEntry;
  programmeOffsetMs?: number;
}

interface PreparedEncoder {
  target: EncoderTarget;
  child: ChildProcess;
  done: Promise<number | null>;
  stderr: string;
  transport: PassThrough;
}

// Only one upcoming source is held. Its unread stdout and OS pipe provide
// bounded backpressure; no whole programmes are cached or rendered to disk.
interface ContinuityState {
  leadMs: number;
  current?: { scheduleEntryId: string; title: string; actualStartMs: number;
    plannedStartMs: number; plannedOffsetMs: number; plannedDurationMs: number } | undefined;
}

class EncoderQueue {
  private prepared: PreparedEncoder | undefined;
  private active: PreparedEncoder | undefined;
  stopped = false;
  readonly continuity = new Map<number, number>();
  private nachtLogo: PreparedLogo | undefined;

  constructor(private readonly config: AppConfig, private readonly logo: PreparedLogo,
    private readonly verbose: boolean, private readonly clips: RotationClip[], private readonly db: LkpDatabase) {
    this.nachtLogo = config.station?.enabled ? prepareLogo(profileConfig(config, 'ln')) : undefined;
  }

  private launch(target: EncoderTarget): PreparedEncoder {
    const targetConfig = this.config.station && target.entry.presentation ? { ...this.config, station: { ...this.config.station, enabled: true } } : this.config;
    if (targetConfig.station?.enabled && !this.nachtLogo) this.nachtLogo = prepareLogo(profileConfig(targetConfig, 'ln'));
    if (!target.media && target.entry.presentation?.kind === 'programme') target.media = this.db.listMedia(false).find(m => m.id === target.entry.mediaId);
    const startsAtMs = target.entry.startsAtMs + target.outputOffsetMs;
    const durationMs = target.limitMs ?? (target.intermission || target.entry.presentation ? target.entry.durationMs - target.seekMs : Number.POSITIVE_INFINITY);
    const programme = target.programme ?? target.entry;
    const programmeOffsetMs = target.programmeOffsetMs ?? target.seekMs;
    const comingUp = comingUpForPiece(programme, programmeOffsetMs,
      target.limitMs ?? target.entry.durationMs - (target.plannedOffsetMs ?? target.seekMs),
      () => this.db.nextPublicEntries(programme.endsAtMs), this.config);
    const ffmpegArgs = buildFfmpegArgs(target.entry, target.media, target.seekMs, durationMs,
      target.animate, targetConfig, target.entry.presentation?.profile === 'ln' ? this.nachtLogo ?? this.logo : this.logo, target.outputOffsetMs, comingUp);
    const command = this.config.video.cpuAffinity ? 'taskset' : 'ffmpeg';
    const args = this.config.video.cpuAffinity ? ['--cpu-list', this.config.video.cpuAffinity, 'ffmpeg', ...ffmpegArgs] : ffmpegArgs;
    const child = spawnLogged(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }, this.verbose);
    const transport = new PassThrough({ highWaterMark: 188 * 64 });
    const source: PreparedEncoder = { target, child, done: waitFor(child), stderr: '', transport };
    // Preparation errors are reported when the scheduled item is acquired.
    void source.done.catch(() => {});
    child.stderr!.on('data', (chunk: Buffer) => { source.stderr = (source.stderr + chunk.toString()).slice(-8192); });
    transport.pause();
    child.stdout!.pipe(transport);
    const launchedAtMs = Date.now();
    transport.once('readable', () => {
      transport.pause();
      if (transport.readableLength) log('info', 'Programme encoder has transport ready', {
        scheduleEntryId: target.entry.id, startupMs: Date.now() - launchedAtMs,
        preparedAheadMs: Math.max(0, startsAtMs - Date.now()),
      });
    });
    return source;
  }

  prepare(target: EncoderTarget | undefined, leadMs: number): void {
    if (this.stopped || !target) return;
    if (target.intermission && (!this.config.station?.enabled || target.entry.presentation?.profile === 'lkp')) {
      const clip = recoveryIntermission(this.clips, target.entry.durationMs, leadMs, target.entry.startsAtMs);
      if (clip) {
        log('info', 'Recovery intermission prepared', {
          scheduleEntryId: target.entry.id, clipId: clip.id, leadMs,
          plannedDurationMs: target.entry.durationMs, replacementDurationMs: clip.durationMs,
        });
        target = { ...target, entry: { ...target.entry, mediaPath: clip.mediaPath,
          episodeTitle: clip.title, durationMs: clip.durationMs, endsAtMs: target.entry.startsAtMs + clip.durationMs } };
      }
    }
    this.discard(this.prepared);
    this.prepared = this.launch(target);
  }

  nextStatus(): PlayoutStatus['next'] {
    const source = this.prepared;
    return source ? { scheduleEntryId: source.target.entry.id,
      title: `${source.target.entry.showTitle}: ${source.target.entry.episodeTitle}`,
      ready: source.transport.readableLength > 0 } : null;
  }

  acquire(target: EncoderTarget): PreparedEncoder {
    const candidate = this.prepared;
    this.prepared = undefined;
    // Match source identity and source seek, not the obsolete planned output
    // start. A prepared recovery intermission may intentionally use another clip.
    const same = candidate && candidate.target.entry.id === target.entry.id &&
      (candidate.target.entry.mediaPath === target.entry.mediaPath || target.intermission) &&
      Math.abs(candidate.target.seekMs - target.seekMs) < 1000;
    if (!same) this.discard(candidate);
    this.active = same ? candidate : this.launch(target);
    return this.active;
  }

  release(source: PreparedEncoder): void {
    this.discard(source);
    if (this.active === source) this.active = undefined;
  }

  private discard(source: PreparedEncoder | undefined): void {
    if (!source) return;
    stopChild(source.child);
    source.child.stdout?.unpipe(source.transport);
    source.child.stdout?.destroy();
    source.transport.destroy();
    const force = setTimeout(() => { if (source.child.exitCode === null && source.child.signalCode === null) source.child.kill('SIGKILL'); }, 1000);
    force.unref();
    void source.done.finally(() => clearTimeout(force)).catch(() => {});
  }

  stop(): void {
    this.stopped = true;
    this.discard(this.active); this.discard(this.prepared);
    this.prepared = undefined;
  }
}

function firstEncoderTarget(entry: ScheduleEntry, media: MediaItem | undefined, animate: boolean): EncoderTarget {
  const plan = entry.playoutPlan;
  if (!plan) return { entry, media, seekMs: 0, outputOffsetMs: 0, animate, intermission: entry.showId === 'lkp-intermissions', programme: entry, programmeOffsetMs: 0 };
  const segment = plan.segments[0]!;
  const internal = segment.type !== 'content' && segment.type !== 'credits';
  const { playoutPlan: _plan, ...base } = entry;
  return {
    entry: { ...base, id: `${entry.id}:0`, mediaPath: segment.mediaPath, durationMs: segment.durationMs,
      endsAtMs: entry.startsAtMs + segment.durationMs,
      ...(internal ? { showId: 'lkp-internal', listingVisibility: 'hidden' as const } : {}) },
    media: internal ? undefined : media,
    seekMs: internal ? 0 : segment.fromMs, outputOffsetMs: 0, animate: animate && !internal,
    ...(internal ? {} : { limitMs: segment.durationMs }), intermission: segment.type === 'intermission',
    programme: entry, programmeOffsetMs: 0,
  };
}

async function transcodeEntry(
  target: EncoderTarget, config: AppConfig, sinks: Writable[], stopAtMs: number, pastOffsetMs: number,
  onChild: (child: ChildProcess | undefined) => void, queue: EncoderQueue,
  next: () => EncoderTarget | undefined, phase: ContinuityState,
): Promise<{ code: number | null; endedAtMs: number }> {
  const deadline = stopAtMs;
  const source = queue.acquire(target);
  const child = source.child;
  onChild(child);
  phase.current = { scheduleEntryId: target.entry.id,
    title: `${source.target.entry.showTitle}: ${source.target.entry.episodeTitle}`,
    actualStartMs: target.entry.startsAtMs + pastOffsetMs,
    plannedStartMs: target.plannedStartsAtMs ?? target.entry.startsAtMs,
    plannedOffsetMs: target.plannedOffsetMs ?? 0, plannedDurationMs: target.entry.durationMs };
  const actualClockMs = target.entry.startsAtMs + target.outputOffsetMs;
  const sourceClockMs = source.target.entry.startsAtMs + source.target.outputOffsetMs;
  const timestampOffsetMs = (actualClockMs % 86_400_000) - (sourceClockMs % 86_400_000);
  const pacer = new TransportPacer(config.video.muxRate,
    actualClockMs + pastOffsetMs, queue.continuity, timestampOffsetMs);
  const drained = finished(pacer, { cleanup: true });
  void drained.catch(() => {});
  for (const sink of sinks) pacer.pipe(sink, { end: false });
  source.transport.pipe(pacer);
  // Always hold the next source from the start of the current piece. Unexpected
  // early EOF must not beat a timer tied to the nominal programme boundary.
  queue.prepare(next(), phase.leadMs);
  const timer = Number.isFinite(deadline) ? setInterval(() => {
    if (Date.now() >= deadline) { clearInterval(timer); queue.release(source); pacer.destroy(); }
  }, 10) : undefined;
  try {
    const code = await source.done;
    try { await drained; }
    catch (error) { if (!queue.stopped && Date.now() < deadline) throw error; }
    const earlyByMs = deadline - Date.now();
    if (!queue.stopped && code !== 0 && earlyByMs > 1000) {
      throw new Error(`FFmpeg exited ${Math.round(earlyByMs)} ms before boundary (code ${code}): ${source.stderr.trim()}`);
    }
    // EOF advances the sequence immediately; the immutable schedule is the
    // timing reference for later recovery, never a reason to reopen this item.
    return { code, endedAtMs: Date.now() };
  } finally {
    clearInterval(timer);
    source.transport.unpipe(pacer);
    for (const sink of sinks) pacer.unpipe(sink);
    pacer.destroy(); queue.release(source); onChild(undefined);
  }
}

async function transcodePlayout(
  entry: ScheduleEntry, media: MediaItem | undefined, elapsedMs: number, animate: boolean,
  config: AppConfig, sinks: Writable[], stopAtMs: number, pastOffsetMs: number,
  onChild: (child: ChildProcess | undefined) => void, queue: EncoderQueue,
  nextProgramme: () => EncoderTarget | undefined, phase: ContinuityState,
): Promise<{ code: number | null; endedAtMs: number }> {
  const plan = entry.playoutPlan;
  if (!plan) {
    const runtimeEntry = { ...entry, startsAtMs: Date.now() - pastOffsetMs };
    const result = await transcodeEntry({ entry: runtimeEntry, media, seekMs: elapsedMs,
      outputOffsetMs: 0, animate, intermission: entry.showId === 'lkp-intermissions',
      ...(config.station?.enabled ? { limitMs: entry.durationMs - elapsedMs } : {}),
      plannedStartsAtMs: entry.startsAtMs, plannedOffsetMs: elapsedMs, programme: entry, programmeOffsetMs: elapsedMs },
      config, sinks, stopAtMs, pastOffsetMs, onChild, queue, nextProgramme, phase);
    phase.leadMs = entry.endsAtMs + pastOffsetMs - result.endedAtMs;
    return result;
  }
  const position = locatePlayoutPosition(plan, elapsedMs);
  if (!position) return { code: 0, endedAtMs: Date.now() };
  const { playoutPlan: _plan, ...baseEntry } = entry;
  let cumulativeMs = plan.segments.slice(0, position.segmentIndex).reduce((sum, segment) => sum + segment.durationMs, 0);
  let last = { code: 0 as number | null, endedAtMs: Date.now() };
  for (let index = position.segmentIndex; index < plan.segments.length; index += 1) {
    if (queue.stopped || Date.now() >= stopAtMs) return last;
    const segment = plan.segments[index]!;
    const segmentEndMs = entry.startsAtMs + cumulativeMs + segment.durationMs;
    const segmentElapsedMs = index === position.segmentIndex ? position.offsetMs : 0;
    const internal = segment.type !== 'content' && segment.type !== 'credits';
    const target: EncoderTarget = {
      entry: { ...baseEntry, id: `${entry.id}:${index}`, startsAtMs: Date.now() - pastOffsetMs,
        endsAtMs: segmentEndMs, durationMs: segment.durationMs, mediaPath: segment.mediaPath,
        ...(internal ? { showId: 'lkp-internal', listingVisibility: 'hidden' as const } : {}) },
      media: internal ? undefined : media, seekMs: (internal ? 0 : segment.fromMs) + segmentElapsedMs,
      outputOffsetMs: 0, animate: animate && index === 0,
      ...(internal ? {} : { limitMs: segment.durationMs - segmentElapsedMs }),
      intermission: segment.type === 'intermission',
      plannedStartsAtMs: entry.startsAtMs + cumulativeMs, plannedOffsetMs: segmentElapsedMs,
      programme: entry, programmeOffsetMs: cumulativeMs + segmentElapsedMs,
    };
    const nextSegment = (): EncoderTarget | undefined => {
      const following = plan.segments[index + 1];
      if (!following) return nextProgramme();
      const followingInternal = following.type !== 'content' && following.type !== 'credits';
      return {
        entry: { ...baseEntry, id: `${entry.id}:${index + 1}`, startsAtMs: segmentEndMs,
          endsAtMs: segmentEndMs + following.durationMs, durationMs: following.durationMs,
          mediaPath: following.mediaPath,
          ...(followingInternal ? { showId: 'lkp-internal', listingVisibility: 'hidden' as const } : {}) },
        media: followingInternal ? undefined : media,
        seekMs: followingInternal ? 0 : following.fromMs, outputOffsetMs: 0, animate: false,
        ...(followingInternal ? {} : { limitMs: following.durationMs }),
        intermission: following.type === 'intermission',
        programme: entry, programmeOffsetMs: cumulativeMs + segment.durationMs,
      };
    };
    last = await transcodeEntry(target, config, sinks, stopAtMs, pastOffsetMs, onChild, queue, nextSegment, phase);
    phase.leadMs = segmentEndMs + pastOffsetMs - last.endedAtMs;
    cumulativeMs += segment.durationMs;
  }
  return last;
}

export function scheduleTimeForBroadcast(realTimeMs: number, pastOffsetMs: number): number {
  return realTimeMs - pastOffsetMs;
}

export function shiftScheduleForBroadcast(entries: ScheduleEntry[], pastOffsetMs: number): ScheduleEntry[] {
  if (!pastOffsetMs) return entries;
  return entries.map((entry) => ({
    ...entry,
    startsAtMs: entry.startsAtMs + pastOffsetMs,
    endsAtMs: entry.endsAtMs + pastOffsetMs,
  }));
}

function writeBroadcastEpg(db: LkpDatabase, config: AppConfig, realNowMs: number, pastOffsetMs: number): void {
  const scheduleNowMs = scheduleTimeForBroadcast(realNowMs, pastOffsetMs);
  const entries = db.listSchedule(scheduleNowMs - 86_400_000, scheduleNowMs + config.schedule.epgDays * 86_400_000);
  writeEpgAtomic(shiftScheduleForBroadcast(entries, pastOffsetMs), config);
}

function prepareFifo(config: AppConfig): void {
  fs.mkdirSync(path.dirname(config.broadcast.fifo), { recursive: true });
  try {
    const stat = fs.lstatSync(config.broadcast.fifo);
    if (!stat.isFIFO()) fs.unlinkSync(config.broadcast.fifo);
    else fs.unlinkSync(config.broadcast.fifo);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const result = spawnSync('mkfifo', [config.broadcast.fifo], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Could not create transport FIFO: ${result.stderr}`);
}

function startRfPipeline(config: AppConfig, acknowledged: boolean, verbose: boolean): { sink: Writable; tsp: ChildProcess; transmitter: ChildProcess } {
  if (!acknowledged) throw new Error('RF transmission requires --i-understand-rf (and compliance with local spectrum rules)');
  prepareFifo(config);
  const transmitter = spawnLogged('python3', [config.broadcast.transmitter, '--source', config.broadcast.fifo,
    '--frequency', String(config.broadcast.frequencyHz), '--gain', String(config.broadcast.gainDb), '--amplitude', String(config.broadcast.amplitude),
    '--seconds', '0', '--i-understand-rf'], { stdio: ['ignore', 'inherit', verbose ? 'pipe' : 'inherit'] }, verbose);
  const tspArgs = ['--realtime', '-I', 'file', '-', '-P', 'continuity', '--fix', '-P', 'eitinject',
    '--files', config.epg.output, '--terrestrial', '--time', 'system', '--ts-id', String(config.channel.transportStreamId),
    '-P', 'pcrbitrate', '-P', 'regulate', '-O', 'file', config.broadcast.fifo];
  const tsp = spawnLogged('tsp', tspArgs, { stdio: ['pipe', 'inherit', verbose ? 'pipe' : 'inherit'] }, verbose);
  return { sink: tsp.stdin!, tsp, transmitter };
}

export function internetFfmpegArgs(config: AppConfig): string[] {
  const segment = path.join(config.internet.hlsDirectory, 'segment-%09d.ts');
  const playlist = path.join(config.internet.hlsDirectory, 'stream.m3u8');
  return [
    '-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-fflags', '+genpts+discardcorrupt', '-f', 'mpegts', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0',
    // Video is the exact already-encoded channel output. Only the small audio
    // stream is converted from DVB MP2 to browser-compatible AAC.
    // Declares the copied video's existing rate for HLS master metadata only.
    '-c:v', 'copy', '-b:v', config.video.bitrate, '-c:a', 'aac', '-b:a', config.internet.audioBitrate, '-ar', '48000', '-ac', '2',
    '-f', 'hls', '-hls_time', String(config.internet.segmentSeconds),
    '-hls_list_size', String(config.internet.playlistSegments),
    // Retain another playlist's worth of segments for delayed requests/retries.
    '-hls_delete_threshold', String(config.internet.playlistSegments),
    '-hls_start_number_source', 'epoch',
    '-master_pl_name', 'master.m3u8',
    '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments+program_date_time+temp_file',
    '-hls_segment_filename', segment, playlist,
  ];
}

function startInternetPipeline(config: AppConfig): { sink: Writable; relay: ChildProcess } {
  fs.mkdirSync(config.internet.hlsDirectory, { recursive: true });
  for (const name of fs.readdirSync(config.internet.hlsDirectory)) {
    if (/^((?:master|stream)\.m3u8|segment-\d+\.ts)(\.tmp)?$/.test(name)) fs.unlinkSync(path.join(config.internet.hlsDirectory, name));
  }
  const relay = spawnLogged('ffmpeg', internetFfmpegArgs(config), { stdio: ['pipe', 'ignore', 'inherit'] }, true);
  if (!relay.stdin) throw new Error('Internet HLS relay has no input pipe');
  return { sink: relay.stdin, relay };
}

export async function runBroadcast(db: LkpDatabase, config: AppConfig, options: BroadcastOptions): Promise<void> {
  if (config.station?.enabled && (config.station.activateAtMs ?? 0) > Date.now()) config.station = { ...config.station, enabled: false };
  const pastOffsetMs = options.pastOffsetMs ?? 0;
  if (!Number.isSafeInteger(pastOffsetMs)) throw new Error('pastOffsetMs must be a non-negative safe integer');
  const epgOffsetMs = options.dryRun ? 0 : pastOffsetMs;
  const logo = prepareLogo(config);
  ensureSchedule(db, config);
  const now = Date.now();
  writeBroadcastEpg(db, config, now, epgOffsetMs);
  if (pastOffsetMs) {
    log('info', 'Broadcast clock shifted into the past', {
      pastOffsetMs,
      scheduleTime: new Date(scheduleTimeForBroadcast(now, pastOffsetMs)).toISOString(),
    });
  }
  const mediaById = new Map(db.listMedia(false).map((media) => [media.id, media]));
  let tsp: ChildProcess | undefined;
  let transmitter: ChildProcess | undefined;
  let internetRelay: ChildProcess | undefined;
  let currentFfmpeg: ChildProcess | undefined;
  const serviceDeadline = options.maxSeconds ? Date.now() + options.maxSeconds * 1000 : Number.POSITIVE_INFINITY;
  const encoderQueue = new EncoderQueue(config, logo, options.verbose, readRotationLibrary(config), db);
  let stopping = false;
  let outputFailure: Error | undefined;
  const sinks: Writable[] = [];
  const watch = (child: ChildProcess, name: string) => child.once('close', (code, signal) => {
    if (!stopping) {
      outputFailure = new Error(`${name} stopped unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'})`);
      encoderQueue.stop(); stopChild(currentFfmpeg);
    }
  });
  if (options.dryRun) {
    const output = path.resolve(options.output ?? path.join(config.storage.runtimeDirectory, 'preview.ts'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    sinks.push(fs.createWriteStream(output));
    log('info', 'Dry-run transport stream output opened', { output });
  } else {
    const mode = options.mode ?? config.broadcast.mode;
    if (mode === 'dvb' || mode === 'both') {
      const pipeline = startRfPipeline(config, options.rfAcknowledged, options.verbose);
      ({ tsp, transmitter } = pipeline); sinks.push(pipeline.sink);
      watch(tsp, 'TSDuck pipeline'); watch(transmitter, 'HackRF transmitter');
      log('info', 'DVB-T output started', { frequencyHz: config.broadcast.frequencyHz, gainDb: config.broadcast.gainDb });
    }
    if (mode === 'internet' || mode === 'both') {
      const pipeline = startInternetPipeline(config);
      internetRelay = pipeline.relay; sinks.push(pipeline.sink);
      watch(internetRelay, 'Internet HLS relay');
      log('info', 'Internet HLS output started', { directory: config.internet.hlsDirectory, videoCodec: 'copy', audioCodec: 'aac' });
    }
    if (!sinks.length) throw new Error(`No output sink for mode ${mode}`);
  }

  const stop = (): void => { stopping = true; encoderQueue.stop(); stopChild(currentFfmpeg); stopChild(tsp); stopChild(transmitter); stopChild(internetRelay); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let first = true;
  let cursor: ScheduleEntry | undefined;
  const completedProfileEntries = new Set<string>();
  const phase: ContinuityState = { leadMs: 0 };
  const statusFile = path.join(config.storage.runtimeDirectory, options.dryRun ? 'playout-preview-status.json' : 'playout-status.json');
  const publishStatus = (state: PlayoutStatus['state'] = 'running'): void => {
    const current = phase.current;
    const updatedAtMs = Date.now();
    const elapsedMs = current ? Math.max(0, updatedAtMs - current.actualStartMs) : 0;
    const leadMs = current ? current.plannedStartMs + Math.min(current.plannedDurationMs,
      current.plannedOffsetMs + elapsedMs) - scheduleTimeForBroadcast(updatedAtMs, pastOffsetMs) : phase.leadMs;
    writePlayoutStatus(statusFile, { version: 1, state, updatedAtMs, pid: process.pid,
      capabilities: ['channel-profiles-v1'],
      leadMs, driftMs: -leadMs, direction: Math.abs(leadMs) < 250 ? 'on-time' : leadMs > 0 ? 'ahead' : 'behind',
      current: current ? { scheduleEntryId: current.scheduleEntryId, title: current.title,
        actualStartMs: current.actualStartMs, plannedStartMs: current.plannedStartMs } : null,
      next: state === 'running' ? encoderQueue.nextStatus() : null });
  };
  const statusTimer = setInterval(() => publishStatus(), 1000);
  publishStatus();
  try {
    while (!stopping) {
      if (outputFailure) throw outputFailure;
      const realNowMs = Date.now();
      const scheduleNowMs = scheduleTimeForBroadcast(realNowMs, pastOffsetMs);
      if (config.station && !config.station.enabled) {
        const updated = loadStationConfig(config.projectRoot);
        if (updated?.enabled && ((updated.activateAtMs ?? 0) <= scheduleNowMs || cursor?.presentation)) config.station = updated;
      }
      let entry = (config.station?.enabled ? db.currentAt(scheduleNowMs) : cursor) ?? db.currentAt(scheduleNowMs) ?? db.nextAfter(scheduleNowMs);
      let committedProfileEntryId = entry?.id;
      if (entry && committedProfileEntryId && config.station?.enabled && completedProfileEntries.has(committedProfileEntryId)) {
        const window = profileWindow(scheduleNowMs, config.station), end = Math.min(entry.endsAtMs, window.endsAtMs);
        if (end - scheduleNowMs <= 80) {
          await waitUntil(end + pastOffsetMs, () => stopping);
          continue;
        }
        const asset = stationAssets(config).get(window.profile === 'ln' ? 'continuity' : 'day-continuity')!;
        entry = { ...entry, id: `${entry.id}:completed-recovery`, mediaId: `station-${window.profile}`,
          showId: `station-${window.profile}`, showTitle: config.station.profiles[window.profile].name,
          episodeTitle: 'Eine kleine Pause', description: 'Das Programm geht gleich weiter.', startsAtMs: scheduleNowMs,
          endsAtMs: end, durationMs: end - scheduleNowMs, mediaPath: asset.path, listingVisibility: 'hidden',
          presentation: { profile: window.profile, kind: 'gap', loop: true } };
      }
      if (entry && config.station?.enabled) {
        if (!mediaById.has(entry.mediaId)) {
          const found = db.listMedia(false).find(m => m.id === entry!.mediaId); if (found) mediaById.set(found.id, found);
        }
        if (!channelEntryAllowed(entry, mediaById.get(entry.mediaId), config.station, scheduleNowMs) || !fs.existsSync(entry.mediaPath)) {
          const window = profileWindow(scheduleNowMs, config.station), asset = stationAssets(config).get(window.profile === 'ln' ? 'continuity' : 'day-continuity')!;
          const end = Math.min(entry.endsAtMs, window.endsAtMs);
          entry = { ...entry, id: `${entry.id}:profile-fallback`, mediaId: `station-${window.profile}`, showId: `station-${window.profile}`,
            showTitle: config.station.profiles[window.profile].name, episodeTitle: 'Eine kleine Pause', description: 'Das Programm geht gleich weiter.',
            startsAtMs: scheduleNowMs, endsAtMs: end, durationMs: end - scheduleNowMs, mediaPath: asset.path, listingVisibility: 'hidden',
            presentation: { profile: window.profile, kind: 'gap', loop: true } };
        }
      }
      if (config.station?.enabled && cursor && cursor.startsAtMs > scheduleNowMs + 80) {
        const profile = profileWindow(scheduleNowMs, config.station).profile;
        const assets = stationAssets(config), asset = assets.get(profile === 'ln' ? 'continuity' : 'day-continuity')!;
        entry = { ...cursor, id: `${cursor.id}:clock-recovery`, startsAtMs: scheduleNowMs, endsAtMs: cursor.startsAtMs,
          durationMs: cursor.startsAtMs - scheduleNowMs, mediaPath: asset.path, listingVisibility: 'hidden',
          presentation: { profile, kind: 'gap', loop: true } };
        committedProfileEntryId = undefined;
      }
      if (!entry) throw new Error(`Schedule does not cover ${new Date(scheduleNowMs).toISOString()}`);
      if (first && entry.startsAtMs > scheduleNowMs) await waitUntil(entry.startsAtMs + pastOffsetMs, () => stopping);
      if (stopping || Date.now() >= serviceDeadline) break;
      const actualStartMs = Date.now();
      const actualScheduleStartMs = scheduleTimeForBroadcast(actualStartMs, pastOffsetMs);
      const seekMs = first || config.station?.enabled ? Math.max(0, actualScheduleStartMs - entry.startsAtMs) : 0;
      const coldStartResume = first && seekMs > 1000;
      const eventId = randomUUID();
      db.startPlayback({
        id: eventId, scheduleEntryId: entry.id, plannedStartMs: entry.startsAtMs, plannedEndMs: entry.endsAtMs,
        actualStartMs, initialSeekMs: seekMs, coldStartResume, status: 'started',
      });
      log('info', 'Programme playout started', { scheduleEntryId: entry.id, title: `${entry.showTitle}: ${entry.episodeTitle}`, seekMs, coldStartResume });
      try {
        const deadline = config.station?.enabled ? Math.min(serviceDeadline, entry.endsAtMs + pastOffsetMs,
          profileWindow(actualScheduleStartMs, config.station).endsAtMs + pastOffsetMs) : serviceDeadline;
        const nextProgramme = () => {
          if (options.once) return undefined;
          const nextEntry = db.currentAt(entry.endsAtMs) ?? db.nextAfter(entry.endsAtMs);
          return nextEntry ? firstEncoderTarget(nextEntry, mediaById.get(nextEntry.mediaId), true) : undefined;
        };
        const result = await transcodePlayout(entry, mediaById.get(entry.mediaId), seekMs, !first && seekMs < 1000, config, sinks, deadline, pastOffsetMs, (child) => { currentFfmpeg = child; }, encoderQueue, nextProgramme, phase);
        if (config.station?.enabled && !stopping && Date.now() < deadline - 80) {
          // EOF recovery stays on this profile until its committed boundary.
          // It never reopens a completed programme or carries night content into daytime.
          const profile = profileWindow(scheduleTimeForBroadcast(Date.now(), pastOffsetMs), config.station).profile;
          const assets = stationAssets(config), asset = assets.get(profile === 'ln' ? 'continuity' : 'day-continuity') ?? assets.get('ident')!;
          const start = scheduleTimeForBroadcast(Date.now(), pastOffsetMs), duration = deadline - Date.now();
          const filler: ScheduleEntry = { ...entry, id: `${entry.id}:recovery`, mediaId: `station-${profile}`, showId: `station-${profile}`,
            startsAtMs: start, endsAtMs: start + duration, durationMs: duration, mediaPath: asset.path,
            listingVisibility: 'hidden', presentation: { profile, kind: 'gap', loop: true } };
          await transcodePlayout(filler, undefined, 0, false, config, sinks, deadline, pastOffsetMs, child => { currentFfmpeg = child; }, encoderQueue, nextProgramme, phase);
        }
        if (outputFailure) throw outputFailure;
        const realEntryEndMs = entry.endsAtMs + pastOffsetMs;
        if (Date.now() >= serviceDeadline || stopping) {
          db.finishPlayback(eventId, 'interrupted', 'bounded preview completed');
          break;
        }
        const earlyByMs = realEntryEndMs - result.endedAtMs;
        if (result.code !== 0 && earlyByMs > 1000) throw new Error(`FFmpeg exited ${Math.round(earlyByMs)} ms before boundary (code ${result.code})`);
        db.finishPlayback(eventId, 'completed');
        if (config.station?.enabled && committedProfileEntryId) completedProfileEntries.add(committedProfileEntryId);
      } catch (error) {
        db.finishPlayback(eventId, 'failed', error instanceof Error ? error.message : String(error));
        if (config.station?.enabled && committedProfileEntryId) completedProfileEntries.add(committedProfileEntryId);
        log('error', 'Programme playout failed; wall-clock schedule remains authoritative', { scheduleEntryId: entry.id, error: String(error) });
        if (stopping) break;
        if (outputFailure) throw outputFailure;
        phase.leadMs = entry.endsAtMs + pastOffsetMs - Date.now();
        if (config.station?.enabled) {
          const fallbackNowMs = scheduleTimeForBroadcast(Date.now(), pastOffsetMs);
          const fallbackWindow = profileWindow(fallbackNowMs, config.station);
          const fallbackProfile = fallbackWindow.profile;
          const fallbackDeadline = Math.min(serviceDeadline, entry.endsAtMs + pastOffsetMs,
            fallbackWindow.endsAtMs + pastOffsetMs);
          if (fallbackDeadline > Date.now() + 80) {
            const id = fallbackProfile === 'ln' ? 'continuity' : 'day-continuity';
            const asset = stationAssets(config).get(id);
            if (!asset) throw new Error(`Missing safe fallback asset: ${id}`);
            const start = scheduleTimeForBroadcast(Date.now(), pastOffsetMs);
            const end = scheduleTimeForBroadcast(fallbackDeadline, pastOffsetMs);
            const filler: ScheduleEntry = { ...entry, id: `${entry.id}:failure-recovery`, mediaId: `station-${fallbackProfile}`,
              showId: `station-${fallbackProfile}`, showTitle: config.station.profiles[fallbackProfile].name,
              episodeTitle: 'Eine kleine Pause', description: 'Das Programm geht gleich weiter.', startsAtMs: start,
              endsAtMs: end, durationMs: end - start, mediaPath: asset.path, listingVisibility: 'hidden',
              presentation: { profile: fallbackProfile, kind: 'gap', loop: true } };
            await transcodePlayout(filler, undefined, 0, false, config, sinks, fallbackDeadline, pastOffsetMs,
              child => { currentFfmpeg = child; }, encoderQueue, () => undefined, phase);
          } else if (fallbackDeadline > Date.now()) {
            await waitUntil(fallbackDeadline, () => stopping);
          }
        }
      }
      cursor = db.currentAt(entry.endsAtMs) ?? db.nextAfter(entry.endsAtMs);
      if (!cursor && !options.once) throw new Error('Schedule has no next item');
      phase.current = undefined;
      publishStatus();
      log('info', 'Continuity timing after item', { scheduleEntryId: entry.id, leadMs: phase.leadMs });
      first = false;
      if (options.once) break;
      if (Date.now() >= serviceDeadline) break;
      writeBroadcastEpg(db, config, Date.now(), epgOffsetMs);
    }
  } finally {
    stopping = true;
    clearInterval(statusTimer);
    phase.current = undefined;
    publishStatus('stopped');
    encoderQueue.stop();
    for (const sink of sinks) sink.end();
    if (options.dryRun && sinks[0]) await finished(sinks[0], { cleanup: true });
    stopChild(tsp); stopChild(transmitter); stopChild(internetRelay);
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
