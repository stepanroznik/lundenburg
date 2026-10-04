import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { AppConfig, MediaItem, ScheduleEntry, SubtitleTrack } from './types.js';
import { assertMediaStorage } from './media-storage.js';
import { acquireWeatherLock } from './weather/lock.js';

const revision = 'dvb-libass-v1';
export const dvbLanguage = (language: string): string => ({ cs: 'ces', de: 'deu', en: 'eng', sk: 'slk' })[language] ?? language;
const languages = new Set(['cs', 'de', 'en', 'sk']);
const textCodecs = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt']);
interface Prepared { revision: string; path: string; language: string; width: number; height: number }
const rendererHashes = new Map<string, { modified: number; hash: string }>();
function rendererPath(config: AppConfig): string { return path.join(config.storage.runtimeDirectory, 'tools/dvb-subtitles/render'); }
function rendererHash(config: AppConfig): string {
  const file = rendererPath(config), modified = fs.statSync(file).mtimeMs;
  const cached = rendererHashes.get(file);
  if (cached?.modified === modified) return cached.hash;
  const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  rendererHashes.set(file, { modified, hash });
  return hash;
}

export function textSubtitleTracks(entry: ScheduleEntry, media?: MediaItem): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = media?.subtitles ?? ['cs', 'de', 'en', 'sk'].flatMap(language => {
    const file = entry.mediaPath.replace(/\.[^.]+$/, `.${language}.srt`);
    return fs.existsSync(file) ? [{ language, kind: 'sidecar' as const, path: file, codec: 'srt' }] : [];
  });
  const selected = new Map<string, SubtitleTrack>();
  const native = new Set(tracks.filter(t => t.kind === 'dvb-bitmap').map(t => t.language));
  for (const track of [...tracks].sort((a, b) => Number(b.kind === 'sidecar') - Number(a.kind === 'sidecar'))) {
    if (!languages.has(track.language) || native.has(track.language) || selected.has(track.language) || track.syncStatus === 'failed') continue;
    if (track.kind === 'dvb-bitmap' || !textCodecs.has(track.codec ?? '') || (!track.path && track.streamIndex === undefined)) continue;
    selected.set(track.language, track);
  }
  return [...selected.values()];
}

function cacheDirectory(entry: ScheduleEntry, track: SubtitleTrack, config: AppConfig): string {
  const input = track.path ?? entry.mediaPath;
  const stat = fs.statSync(input);
  const hash = createHash('sha256').update(JSON.stringify({ revision, input, size: stat.size, modified: stat.mtimeMs,
    content: track.path ? createHash('sha256').update(fs.readFileSync(track.path)).digest('hex') : undefined,
    index: track.streamIndex, language: track.language, width: config.video.width, height: config.video.height,
    renderer: rendererHash(config),
  })).digest('hex');
  return path.join(config.media.generatedRoot, 'lkp-subtitles', hash);
}

export function preparedSubtitleTracks(entry: ScheduleEntry, media: MediaItem | undefined, config: AppConfig): SubtitleTrack[] {
  return textSubtitleTracks(entry, media).flatMap(track => {
    try {
      const file = path.join(cacheDirectory(entry, track, config), 'ready.json');
      if (!fs.existsSync(file)) return [];
      const prepared = JSON.parse(fs.readFileSync(file, 'utf8')) as Prepared;
      if (prepared.revision !== revision || !fs.existsSync(prepared.path)) return [];
      return [{ ...track, kind: 'dvb-bitmap' as const, codec: 'dvb_subtitle', path: prepared.path, streamIndex: 0 }];
    } catch { return []; }
  });
}

async function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-8192); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output) : reject(new Error(`${command}: ${error.trim() || `exit ${code}`}`)));
  });
}

export async function prepareSubtitle(entry: ScheduleEntry, track: SubtitleTrack, config: AppConfig, sourceDurationMs: number): Promise<string> {
  assertMediaStorage(config);
  const directory = cacheDirectory(entry, track, config);
  const ready = path.join(directory, 'ready.json');
  if (fs.existsSync(ready)) {
    const prepared = JSON.parse(fs.readFileSync(ready, 'utf8')) as Prepared;
    if (prepared.revision === revision && fs.existsSync(prepared.path)) return prepared.path;
  }
  const renderer = rendererPath(config);
  if (!fs.existsSync(renderer)) throw new Error('Build the DVB subtitle renderer with bash scripts/build-subtitle-renderer.sh');
  fs.mkdirSync(directory, { recursive: true });
  const unlock = acquireWeatherLock(path.join(directory, '.lock'));
  try {
    const normalized = path.join(directory, 'source.ass');
    const partial = path.join(directory, 'subtitles.partial.mkv');
    const output = path.join(directory, 'subtitles.mkv');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', track.path ?? entry.mediaPath,
      '-map', `0:${track.path ? 's:0' : track.streamIndex}`, '-c:s', 'ass', '-f', 'ass', normalized]);
    await run(renderer, [normalized, partial, String(config.video.width), String(config.video.height), String(Math.round(sourceDurationMs)), dvbLanguage(track.language)]);
    // Decode the actual bitmap payload before exposing this cache to playout.
    const verified = JSON.parse(await run(renderer, ['--verify', partial])) as { nonempty: number; maxDepth: number };
    if (!verified.nonempty) throw new Error('DVB renderer produced no visible captions');
    if (verified.maxDepth !== 4) throw new Error('DVB renderer did not produce TV-compatible 4-bit regions');
    const probe = JSON.parse(await run(config.media.ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', partial])) as { streams: Array<{ codec_name: string; tags?: { language?: string } }> };
    if (probe.streams.length !== 1 || probe.streams[0]!.codec_name !== 'dvb_subtitle' || probe.streams[0]!.tags?.language !== dvbLanguage(track.language)) throw new Error('DVB cache failed codec/language validation');
    fs.renameSync(partial, output);
    const metadata: Prepared = { revision, path: output, language: track.language, width: config.video.width, height: config.video.height };
    fs.writeFileSync(`${ready}.partial`, JSON.stringify(metadata, null, 2));
    fs.renameSync(`${ready}.partial`, ready);
    return output;
  } finally { unlock(); }
}
