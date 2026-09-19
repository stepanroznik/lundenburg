import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import type { AppConfig, MediaItem, ScheduleEntry } from './types.js';
import { LkpDatabase } from './database.js';
import { writeEpgAtomic } from './epg.js';
import { ensureSchedule } from './schedule.js';
import { prepareLogo, type PreparedLogo } from './logo.js';

export interface BroadcastOptions {
  dryRun: boolean;
  once: boolean;
  output?: string;
  rfAcknowledged: boolean;
  verbose: boolean;
  maxSeconds?: number;
}

function log(level: string, message: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`);
}

function seconds(ms: number): string { return (Math.max(0, ms) / 1000).toFixed(3); }

export function buildFfmpegArgs(
  entry: ScheduleEntry, media: MediaItem | undefined, seekMs: number, remainingMs: number,
  animate: boolean, config: AppConfig, logo: PreparedLogo,
): string[] {
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-filter_complex_threads', String(config.video.filterThreads),
    '-threads', String(config.video.decoderThreads), '-ss', seconds(seekMs), '-i', entry.mediaPath,
    '-threads', '1', '-framerate', String(config.video.fps), '-i', logo.path];
  const d = config.logo.transitionDurationMs / 1000;
  const eased = `(1-pow(1-min(t/${d}\\,1)\\,3))`;
  const scale = `(1+${config.logo.transitionZoom - 1}*sin(PI*${eased}))`;
  const angle = `if(lt(t\\,${d})\\,2*PI*${config.logo.transitionRotations}*${eased}\\,0)`;
  // The finite in-memory loop ends on an unrotated, normal-size frame.
  // Framesync then holds it; animation filters do no work for the rest of the programme.
  const frames = Math.ceil(d * config.video.fps) + 1;
  const canvas = Math.ceil(Math.hypot(logo.width, logo.height) * config.logo.transitionZoom / 4) * 4;
  const bugFilter = animate
    ? `[1:v:0]loop=loop=${frames - 1}:size=1:start=0,setpts=N/(${config.video.fps}*TB),` +
      `scale=w='${logo.width}*${scale}':h='${logo.height}*${scale}':eval=frame,` +
      `rotate=angle='${angle}':ow=${canvas}:oh=${canvas}:c=none,setsar=1,format=yuva420p[bug]`
    : '[1:v:0]format=yuva420p[bug]';
  const videoFilter = [
    `[0:v:0]scale=${config.video.width}:${config.video.height}:force_original_aspect_ratio=decrease,` +
      `pad=${config.video.width}:${config.video.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `fps=${config.video.fps},setsar=1,format=yuv420p[base]`,
    bugFilter,
    `[base][bug]overlay=x=${config.logo.left}-(${animate ? canvas : logo.width}-${logo.width})/2:` +
      `y=${config.logo.top}-(${animate ? canvas : logo.height}-${logo.height})/2:` +
      'eval=init:eof_action=repeat:repeatlast=1:format=yuv420[v]',
  ].join(';');
  args.push('-filter_complex', videoFilter, '-map', '[v]', '-map', '0:a:0?');
  const bitmapTracks = media?.subtitles.filter((subtitle) => subtitle.kind === 'dvb-bitmap' && subtitle.streamIndex !== undefined) ?? [];
  bitmapTracks.forEach((track) => args.push('-map', `0:${track.streamIndex}`));
  args.push(
    '-t', seconds(remainingMs), '-c:v', config.video.codec, '-preset', config.video.preset, '-pix_fmt', 'yuv420p',
    '-threads', String(config.video.encoderThreads),
    '-b:v', config.video.bitrate, '-maxrate', config.video.bitrate, '-bufsize', '7600k', '-g', String(config.video.fps * 2),
    '-c:a', 'mp2', '-b:a', config.video.audioBitrate, '-ar', '48000', '-ac', '2',
  );
  if (bitmapTracks.length) args.push('-c:s', 'dvbsub');
  args.push(
    '-metadata', `service_name=${config.channel.name}`, '-metadata', `service_provider=${config.channel.provider}`,
    '-mpegts_service_id', String(config.channel.serviceId), '-mpegts_transport_stream_id', String(config.channel.transportStreamId),
    '-mpegts_original_network_id', String(config.channel.originalNetworkId), '-mpegts_service_type', 'digital_tv',
    '-mpegts_flags', '+system_b+nit+resend_headers', '-muxrate', String(config.video.muxRate),
    '-streamid', '0:0x100', '-streamid', '1:0x101',
  );
  bitmapTracks.forEach((_track, index) => args.push('-streamid', `${index + 2}:${0x120 + index}`));
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

async function transcodeEntry(
  entry: ScheduleEntry, media: MediaItem | undefined, seekMs: number, animate: boolean,
  config: AppConfig, sink: Writable, verbose: boolean, stopAtMs: number,
  onChild: (child: ChildProcess | undefined) => void, logo: PreparedLogo,
): Promise<{ code: number | null; endedAtMs: number }> {
  const deadline = Math.min(entry.endsAtMs, stopAtMs);
  const remainingMs = Math.max(1, deadline - Date.now());
  const ffmpegArgs = buildFfmpegArgs(entry, media, seekMs, remainingMs, animate, config, logo);
  const command = config.video.cpuAffinity ? 'taskset' : 'ffmpeg';
  const args = config.video.cpuAffinity ? ['--cpu-list', config.video.cpuAffinity, 'ffmpeg', ...ffmpegArgs] : ffmpegArgs;
  const child = spawnLogged(command, args,
    { stdio: ['ignore', 'pipe', verbose ? 'pipe' : 'ignore'] }, verbose);
  onChild(child);
  child.stdout!.pipe(sink, { end: false });
  const timer = setTimeout(() => stopChild(child), Math.max(1, deadline - Date.now() + 150));
  const code = await waitFor(child);
  onChild(undefined);
  clearTimeout(timer);
  child.stdout!.unpipe(sink);
  return { code, endedAtMs: Date.now() };
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

export async function runBroadcast(db: LkpDatabase, config: AppConfig, options: BroadcastOptions): Promise<void> {
  const logo = prepareLogo(config);
  ensureSchedule(db, config);
  const now = Date.now();
  const epgEnd = now + config.schedule.epgDays * 86_400_000;
  writeEpgAtomic(db.listSchedule(now - 86_400_000, epgEnd), config);
  const mediaById = new Map(db.listMedia(false).map((media) => [media.id, media]));
  let tsp: ChildProcess | undefined;
  let transmitter: ChildProcess | undefined;
  let sink: Writable;
  if (options.dryRun) {
    const output = path.resolve(options.output ?? path.join(config.storage.runtimeDirectory, 'preview.ts'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    sink = fs.createWriteStream(output);
    log('info', 'Dry-run transport stream output opened', { output });
  } else {
    const pipeline = startRfPipeline(config, options.rfAcknowledged, options.verbose);
    ({ sink, tsp, transmitter } = pipeline);
    log('info', 'RF pipeline started', { frequencyHz: config.broadcast.frequencyHz, gainDb: config.broadcast.gainDb });
  }

  let stopping = false;
  let currentFfmpeg: ChildProcess | undefined;
  const serviceDeadline = options.maxSeconds ? Date.now() + options.maxSeconds * 1000 : Number.POSITIVE_INFINITY;
  const stop = (): void => { stopping = true; stopChild(currentFfmpeg); stopChild(tsp); stopChild(transmitter); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let first = true;
  try {
    while (!stopping) {
      const wallClock = Date.now();
      const entry = db.currentAt(wallClock) ?? db.nextAfter(wallClock);
      if (!entry) throw new Error(`Schedule does not cover ${new Date(wallClock).toISOString()}`);
      if (entry.startsAtMs > wallClock) await new Promise((resolve) => setTimeout(resolve, entry.startsAtMs - wallClock));
      const actualStartMs = Date.now();
      const seekMs = Math.max(0, actualStartMs - entry.startsAtMs);
      const coldStartResume = first && seekMs > 1000;
      const eventId = randomUUID();
      db.startPlayback({
        id: eventId, scheduleEntryId: entry.id, plannedStartMs: entry.startsAtMs, plannedEndMs: entry.endsAtMs,
        actualStartMs, initialSeekMs: seekMs, coldStartResume, status: 'started',
      });
      log('info', 'Programme playout started', { scheduleEntryId: entry.id, title: `${entry.showTitle}: ${entry.episodeTitle}`, seekMs, coldStartResume });
      try {
        const result = await transcodeEntry(entry, mediaById.get(entry.mediaId), seekMs, !first && seekMs < 1000, config, sink, options.verbose, serviceDeadline, (child) => { currentFfmpeg = child; }, logo);
        if (serviceDeadline < entry.endsAtMs) {
          db.finishPlayback(eventId, 'interrupted', 'bounded preview completed');
          break;
        }
        const earlyByMs = entry.endsAtMs - result.endedAtMs;
        if (result.code !== 0 && earlyByMs > 1000) throw new Error(`FFmpeg exited ${Math.round(earlyByMs)} ms before boundary (code ${result.code})`);
        db.finishPlayback(eventId, 'completed');
      } catch (error) {
        db.finishPlayback(eventId, 'failed', error instanceof Error ? error.message : String(error));
        log('error', 'Programme playout failed; wall-clock schedule remains authoritative', { scheduleEntryId: entry.id, error: String(error) });
        if (stopping) break;
        const wait = entry.endsAtMs - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      first = false;
      if (options.once) break;
      if (Date.now() >= serviceDeadline) break;
      writeEpgAtomic(db.listSchedule(Date.now() - 86_400_000, Date.now() + config.schedule.epgDays * 86_400_000), config);
    }
  } finally {
    sink.end();
    stopChild(tsp); stopChild(transmitter);
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
