import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import type { AppConfig, MediaItem, OutputMode, ScheduleEntry } from './types.js';
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
  pastOffsetMs?: number;
  mode?: OutputMode;
}

function log(level: string, message: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`);
}

function seconds(ms: number): string { return (Math.max(0, ms) / 1000).toFixed(3); }

export function buildFfmpegArgs(
  entry: ScheduleEntry, media: MediaItem | undefined, seekMs: number, remainingMs: number,
  animate: boolean, config: AppConfig, logo: PreparedLogo,
): string[] {
  const intermission = entry.showId === 'lkp-intermissions';
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-filter_complex_threads', String(config.video.filterThreads),
    '-threads', String(config.video.decoderThreads), '-ss', seconds(seekMs), '-i', entry.mediaPath];
  if (!intermission) args.push('-threads', '1', '-framerate', String(config.video.fps), '-i', logo.path);
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
  const filter = intermission ? `[0:v:0]scale=${config.video.width}:${config.video.height}:force_original_aspect_ratio=decrease,pad=${config.video.width}:${config.video.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${config.video.fps},setsar=1,format=yuv420p[v]` : videoFilter;
  args.push('-filter_complex', filter, '-map', '[v]', '-map', '0:a:0?');
  const bitmapTracks = media?.subtitles.filter((subtitle) => subtitle.kind === 'dvb-bitmap' && subtitle.streamIndex !== undefined) ?? [];
  bitmapTracks.forEach((track) => args.push('-map', `0:${track.streamIndex}`));
  args.push(
    '-t', seconds(remainingMs), '-c:v', config.video.codec, '-preset', config.video.preset, '-pix_fmt', 'yuv420p',
    '-threads', String(config.video.encoderThreads),
    '-b:v', config.video.bitrate, '-maxrate', config.video.bitrate, '-bufsize', '7600k', '-g', String(config.video.fps * 2),
    '-c:a', 'mp2', '-b:a', config.video.audioBitrate, '-ar', '48000', '-ac', '2',
    // Programme encoders restart at boundaries. A wall-clock offset keeps the
    // elementary-stream timestamps monotonic for the long-lived HLS remuxer.
    // Keep the value below MPEG-TS's 33-bit clock wrap. The HLS relay corrects
    // the once-daily discontinuity while preserving continuity between shows.
    '-output_ts_offset', (((entry.startsAtMs + seekMs) / 1000) % 86_400).toFixed(3),
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
  config: AppConfig, sinks: Writable[], verbose: boolean, stopAtMs: number, pastOffsetMs: number,
  onChild: (child: ChildProcess | undefined) => void, logo: PreparedLogo,
): Promise<{ code: number | null; endedAtMs: number }> {
  const deadline = Math.min(entry.endsAtMs + pastOffsetMs, stopAtMs);
  const remainingMs = Math.max(1, deadline - Date.now());
  const ffmpegArgs = buildFfmpegArgs(entry, media, seekMs, remainingMs, animate, config, logo);
  const command = config.video.cpuAffinity ? 'taskset' : 'ffmpeg';
  const args = config.video.cpuAffinity ? ['--cpu-list', config.video.cpuAffinity, 'ffmpeg', ...ffmpegArgs] : ffmpegArgs;
  const child = spawnLogged(command, args,
    { stdio: ['ignore', 'pipe', verbose ? 'pipe' : 'ignore'] }, verbose);
  onChild(child);
  for (const sink of sinks) child.stdout!.pipe(sink, { end: false });
  const timer = setTimeout(() => stopChild(child), Math.max(1, deadline - Date.now() + 150));
  const code = await waitFor(child);
  onChild(undefined);
  clearTimeout(timer);
  for (const sink of sinks) child.stdout!.unpipe(sink);
  return { code, endedAtMs: Date.now() };
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
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', config.internet.audioBitrate, '-ar', '48000', '-ac', '2',
    '-f', 'hls', '-hls_time', String(config.internet.segmentSeconds),
    '-hls_list_size', String(config.internet.playlistSegments),
    '-hls_delete_threshold', '2',
    '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments+program_date_time+temp_file',
    '-hls_segment_filename', segment, playlist,
  ];
}

function startInternetPipeline(config: AppConfig): { sink: Writable; relay: ChildProcess } {
  fs.mkdirSync(config.internet.hlsDirectory, { recursive: true });
  for (const name of fs.readdirSync(config.internet.hlsDirectory)) {
    if (/^(stream\.m3u8|segment-\d+\.ts)(\.tmp)?$/.test(name)) fs.unlinkSync(path.join(config.internet.hlsDirectory, name));
  }
  const relay = spawnLogged('ffmpeg', internetFfmpegArgs(config), { stdio: ['pipe', 'ignore', 'inherit'] }, true);
  if (!relay.stdin) throw new Error('Internet HLS relay has no input pipe');
  return { sink: relay.stdin, relay };
}

export async function runBroadcast(db: LkpDatabase, config: AppConfig, options: BroadcastOptions): Promise<void> {
  const pastOffsetMs = options.pastOffsetMs ?? 0;
  if (!Number.isSafeInteger(pastOffsetMs) || pastOffsetMs < 0) throw new Error('pastOffsetMs must be a non-negative safe integer');
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
  let stopping = false;
  let outputFailure: Error | undefined;
  const sinks: Writable[] = [];
  const watch = (child: ChildProcess, name: string) => child.once('close', (code, signal) => {
    if (!stopping) {
      outputFailure = new Error(`${name} stopped unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'})`);
      stopChild(currentFfmpeg);
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

  const serviceDeadline = options.maxSeconds ? Date.now() + options.maxSeconds * 1000 : Number.POSITIVE_INFINITY;
  const stop = (): void => { stopping = true; stopChild(currentFfmpeg); stopChild(tsp); stopChild(transmitter); stopChild(internetRelay); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let first = true;
  try {
    while (!stopping) {
      if (outputFailure) throw outputFailure;
      const realNowMs = Date.now();
      const scheduleNowMs = scheduleTimeForBroadcast(realNowMs, pastOffsetMs);
      const entry = db.currentAt(scheduleNowMs) ?? db.nextAfter(scheduleNowMs);
      if (!entry) throw new Error(`Schedule does not cover ${new Date(scheduleNowMs).toISOString()}`);
      if (entry.startsAtMs > scheduleNowMs) await new Promise((resolve) => setTimeout(resolve, entry.startsAtMs - scheduleNowMs));
      const actualStartMs = Date.now();
      const actualScheduleStartMs = scheduleTimeForBroadcast(actualStartMs, pastOffsetMs);
      const seekMs = Math.max(0, actualScheduleStartMs - entry.startsAtMs);
      const coldStartResume = first && seekMs > 1000;
      const eventId = randomUUID();
      db.startPlayback({
        id: eventId, scheduleEntryId: entry.id, plannedStartMs: entry.startsAtMs, plannedEndMs: entry.endsAtMs,
        actualStartMs, initialSeekMs: seekMs, coldStartResume, status: 'started',
      });
      log('info', 'Programme playout started', { scheduleEntryId: entry.id, title: `${entry.showTitle}: ${entry.episodeTitle}`, seekMs, coldStartResume });
      try {
        const result = await transcodeEntry(entry, mediaById.get(entry.mediaId), seekMs, !first && seekMs < 1000, config, sinks, options.verbose, serviceDeadline, pastOffsetMs, (child) => { currentFfmpeg = child; }, logo);
        if (outputFailure) throw outputFailure;
        const realEntryEndMs = entry.endsAtMs + pastOffsetMs;
        if (serviceDeadline < realEntryEndMs) {
          db.finishPlayback(eventId, 'interrupted', 'bounded preview completed');
          break;
        }
        const earlyByMs = realEntryEndMs - result.endedAtMs;
        if (result.code !== 0 && earlyByMs > 1000) throw new Error(`FFmpeg exited ${Math.round(earlyByMs)} ms before boundary (code ${result.code})`);
        db.finishPlayback(eventId, 'completed');
      } catch (error) {
        db.finishPlayback(eventId, 'failed', error instanceof Error ? error.message : String(error));
        log('error', 'Programme playout failed; wall-clock schedule remains authoritative', { scheduleEntryId: entry.id, error: String(error) });
        if (stopping) break;
        const wait = entry.endsAtMs + pastOffsetMs - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      first = false;
      if (options.once) break;
      if (Date.now() >= serviceDeadline) break;
      writeBroadcastEpg(db, config, Date.now(), epgOffsetMs);
    }
  } finally {
    stopping = true;
    for (const sink of sinks) sink.end();
    stopChild(tsp); stopChild(transmitter); stopChild(internetRelay);
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
