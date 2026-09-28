import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parse } from 'yaml';
import type { AppConfig, Breakpoint, CreditsPolicy, EditorialMarker, ExternalIds, MediaItem, SubtitleTrack } from './types.js';
import { normalizeLanguage, stableId } from './util.js';
import { assertMediaStorage } from './media-storage.js';
import { editorialEnd, scoreBreakSignal } from './editorial.js';

interface ShowMetadata {
  id?: string;
  title?: string;
  description?: string;
  language?: string;
  weight?: number;
  enabled?: boolean;
  episodeTitleTemplate?: string;
  externalIds?: ExternalIds;
  creditsPolicy?: CreditsPolicy;
}

interface EpisodeMetadata {
  id?: string;
  title?: string;
  description?: string;
  season?: number;
  episode?: number;
  enabled?: boolean;
  externalIds?: ExternalIds;
  creditsPolicy?: CreditsPolicy;
  markers?: EditorialMarker[];
  breakpoints?: Array<number | (Partial<Breakpoint> & { atMs: number })>;
}

interface ProbeStream {
  index: number;
  codec_name?: string;
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
  disposition?: { attached_pic?: number };
  tags?: { language?: string; title?: string };
}

interface ProbeResult {
  streams: ProbeStream[];
  format: { duration?: string; format_name?: string; bit_rate?: string; tags?: Record<string, string> };
  chapters?: Array<{ start_time?: string; end_time?: string; tags?: { title?: string } }>;
}

function readYaml<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  const value = parse(fs.readFileSync(file, 'utf8')) as T;
  if (!value || typeof value !== 'object') throw new Error(`Metadata must contain an object: ${file}`);
  return value;
}

export function findShowMetadataFile(mediaRoot: string, mediaDirectory: string): string | undefined {
  const root = path.resolve(mediaRoot);
  let current = path.resolve(mediaDirectory);
  const relative = path.relative(root, current);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Media directory is outside media root: ${mediaDirectory}`);
  while (true) {
    const candidate = path.join(current, 'show.yaml');
    if (fs.existsSync(candidate)) return candidate;
    if (current === root) return undefined;
    current = path.dirname(current);
  }
}

function titleFromSlug(input: string): string {
  return input.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\p{L}/gu, (m) => m.toLocaleUpperCase('cs-CZ'));
}

export function parseEpisodeFilename(filename: string): { season?: number; episode?: number; title: string } {
  const stem = filename.replace(path.extname(filename), '');
  const match = /^S(\d{1,3})E(\d{1,4})\s*(?:[-–—:]\s*)?(.+)$/iu.exec(stem);
  if (!match) return { title: titleFromSlug(stem) };
  return { season: Number(match[1]), episode: Number(match[2]), title: match[3]!.trim() };
}

function episodeFromFilename(filename: string): { season?: number; episode?: number; title: string } {
  const conventional = parseEpisodeFilename(filename);
  if (conventional.season !== undefined) return conventional;
  const stem = filename.replace(path.extname(filename), '');
  const embedded = /S(\d{1,3})E(\d{1,4})\b/iu.exec(stem);
  if (embedded) return { season: Number(embedded[1]), episode: Number(embedded[2]), title: conventional.title };
  const dotted = /^(\d{1,3})\.(\d{1,4})\b/u.exec(stem);
  if (dotted) return { season: Number(dotted[1]), episode: Number(dotted[2]), title: conventional.title };
  const numbered = /^(\d{1,4})\b/u.exec(stem);
  if (numbered) return { episode: Number(numbered[1]), title: conventional.title };
  return conventional;
}

export function episodeTitleFromTemplate(template: string | undefined, parsed: { season?: number; episode?: number; title: string }): string {
  if (!template || parsed.episode === undefined) return parsed.title;
  return template.replaceAll('{season}', String(parsed.season ?? 1)).replaceAll('{episode}', String(parsed.episode));
}

async function ffprobe(binary: string, file: string): Promise<ProbeResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed for ${file}: ${stderr.trim() || `exit ${code}`}`));
      try { resolve(JSON.parse(stdout) as ProbeResult); } catch (error) { reject(new Error(`Invalid ffprobe output for ${file}: ${String(error)}`)); }
    });
  });
}

function walk(root: string, extensions: Set<string>): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walk(full, extensions));
    else if (entry.isFile() && isDiscoverableMediaFile(entry.name, extensions)) result.push(full);
  }
  return result.sort((a, b) => a.localeCompare(b, 'cs'));
}

export function isDiscoverableMediaFile(filename: string, extensions: Set<string>): boolean {
  const lower = filename.toLowerCase();
  return extensions.has(path.extname(lower)) &&
    !lower.endsWith('.lkp-partial.mp4') &&
    !lower.endsWith('.partial.mp4') &&
    !lower.endsWith('.rendering.mp4');
}

export function discoverSidecars(mediaPath: string, allowed: Set<string>, defaultLanguage?: string): SubtitleTrack[] {
  const dir = path.dirname(mediaPath);
  const stem = path.basename(mediaPath, path.extname(mediaPath));
  const tracks: SubtitleTrack[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'cs'))) {
    if (!entry.isFile()) continue;
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^${escaped}(?:\\.([a-z]{2,3}))?\\.(srt|ass)$`, 'i').exec(entry.name);
    if (!match) continue;
    const language = normalizeLanguage(match[1] ?? defaultLanguage);
    if (language && allowed.has(language)) tracks.push({ language, kind: 'sidecar', path: path.join(dir, entry.name), codec: match[2]!.toLowerCase() });
  }
  return tracks;
}

function chapterEditorial(probe: ProbeResult): { markers: EditorialMarker[]; breakpoints: Breakpoint[] } {
  const markers: EditorialMarker[] = [];
  const breakpoints: Breakpoint[] = [];
  for (const chapter of probe.chapters ?? []) {
    const startMs = Math.round(Number(chapter.start_time) * 1000);
    const endMs = Math.round(Number(chapter.end_time) * 1000);
    if (!Number.isFinite(startMs) || startMs < 0) continue;
    const title = chapter.tags?.title?.trim();
    const normalized = title?.toLocaleLowerCase('de') ?? '';
    const credits = /credits|end titles|abspann|nachspann|titulky|crédit/.test(normalized);
    const knownBreak = /werbung|commercial|ad[ -]?break|reklama/.test(normalized);
    markers.push({ kind: credits ? 'credits' : knownBreak ? 'ad-break' : 'chapter', startMs, ...(Number.isFinite(endMs) && endMs > startMs ? { endMs } : {}), ...(title ? { title } : {}), source: 'embedded', confidence: credits || knownBreak ? .9 : .7 });
    if (startMs > 0) breakpoints.push(scoreBreakSignal({ atMs: startMs, known: knownBreak, strongChapter: knownBreak || /part|teil|kapit|chapter/.test(normalized), embeddedChapter: true }));
  }
  return { markers, breakpoints };
}

function manualBreakpoints(values: EpisodeMetadata['breakpoints']): Breakpoint[] {
  return (values ?? []).map((value) => typeof value === 'number'
    ? scoreBreakSignal({ atMs: value, manual: true })
    : {
        atMs: value.atMs, score: value.score ?? 100, confidence: value.confidence ?? 1,
        reason: value.reason ?? ['manual override'], source: 'manual', enabled: value.enabled ?? true,
      });
}

async function localBreakAnalysis(mediaPath: string): Promise<Breakpoint[]> {
  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostats', '-v', 'info', '-skip_frame', 'nokey', '-i', mediaPath, '-vf', 'scale=480:-2,blackdetect=d=0.20:pix_th=0.10', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let output = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`ffmpeg editorial analysis exited ${code}`)));
  });
  const silence: Array<{ start: number; end: number }> = [];
  const starts: number[] = [];
  for (const match of stderr.matchAll(/silence_start:\s*([0-9.]+)/g)) starts.push(Number(match[1]) * 1000);
  let silenceIndex = 0;
  for (const match of stderr.matchAll(/silence_end:\s*([0-9.]+)/g)) {
    const start = starts[silenceIndex++];
    if (start !== undefined) silence.push({ start, end: Number(match[1]) * 1000 });
  }
  const candidates: Breakpoint[] = [];
  for (const match of stderr.matchAll(/black_start:([0-9.]+)\s+black_end:([0-9.]+)/g)) {
    const start = Number(match[1]) * 1000;
    const end = Number(match[2]) * 1000;
    const atMs = Math.round((start + end) / 2);
    const quiet = silence.some((interval) => interval.start <= end + 250 && interval.end >= start - 250);
    candidates.push(scoreBreakSignal({ atMs, black: true, silence: quiet, sceneChange: true, dialogueGap: quiet }));
  }
  return candidates;
}

export async function scanMedia(config: AppConfig, onProgress?: (message: string) => void): Promise<MediaItem[]> {
  assertMediaStorage(config);
  const mediaFiles = walk(config.media.root, new Set(config.media.supportedExtensions));
  if (mediaFiles.length === 0) throw new Error(`No supported media found below ${config.media.root}`);
  const allowedLanguages = new Set(config.media.subtitleLanguages);
  const items: MediaItem[] = [];

  for (const mediaPath of mediaFiles) {
    onProgress?.(`Probing ${path.relative(config.media.root, mediaPath)}`);
    const directory = path.dirname(mediaPath);
    const showFile = findShowMetadataFile(config.media.root, directory);
    const showDirectory = showFile ? path.dirname(showFile) : directory;
    const relativeDirectory = path.relative(config.media.root, showDirectory);
    const show = showFile ? readYaml<ShowMetadata>(showFile) ?? {} : {};
    const stem = mediaPath.slice(0, -path.extname(mediaPath).length);
    const episodeMeta = readYaml<EpisodeMetadata>(`${stem}.yaml`) ?? {};
    const parsed = episodeFromFilename(path.basename(mediaPath));
    const probe = await ffprobe(config.media.ffprobe, mediaPath);
    const durationSeconds = Number(probe.format.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error(`No valid duration detected for ${mediaPath}`);
    const showId = show.id ?? (relativeDirectory.split(path.sep).filter(Boolean).join('-') || 'uncategorized');
    const showTitle = show.title ?? titleFromSlug(path.basename(showDirectory === config.media.root ? showId : showDirectory));
    const episodeTitle = episodeMeta.title ?? episodeTitleFromTemplate(show.episodeTitleTemplate, parsed);
    const description = episodeMeta.description ?? show.description ?? '';
    const defaultLanguage = normalizeLanguage(show.language);
    const subtitles = discoverSidecars(mediaPath, allowedLanguages, defaultLanguage);
    for (const stream of probe.streams.filter((s) => s.codec_type === 'subtitle')) {
      const language = normalizeLanguage(stream.tags?.language);
      if (language && allowedLanguages.has(language)) subtitles.push({
        language, kind: stream.codec_name === 'dvb_subtitle' ? 'dvb-bitmap' : 'embedded', streamIndex: stream.index,
        ...(stream.codec_name ? { codec: stream.codec_name } : {}),
      });
    }
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    const uniqueSubtitles = subtitles.filter((track, i) => subtitles.findIndex((other) => other.language === track.language && other.kind === track.kind && other.path === track.path && other.streamIndex === track.streamIndex) === i);
    const season = episodeMeta.season ?? parsed.season;
    const episode = episodeMeta.episode ?? parsed.episode;
    const audioLanguage = normalizeLanguage(audio?.tags?.language ?? show.language);
    const chapters = chapterEditorial(probe);
    const editorialMarkers = [...chapters.markers, ...(episodeMeta.markers ?? [])].sort((a, b) => a.startMs - b.startMs);
    let breakpoints = [...chapters.breakpoints, ...manualBreakpoints(episodeMeta.breakpoints)];
    const durationMs = Math.round(durationSeconds * 1000);
    const qcWarnings: string[] = [];
    if (durationMs > 35 * 60_000) {
      onProgress?.(`Analyzing editorial breaks in ${path.relative(config.media.root, mediaPath)}`);
      try { breakpoints = [...breakpoints, ...await localBreakAnalysis(mediaPath)]; }
      catch (error) { qcWarnings.push(`Local breakpoint analysis failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
    breakpoints.sort((a, b) => a.atMs - b.atMs);
    const effectiveEditorialDurationMs = editorialEnd(editorialMarkers, durationMs);
    const externalIds = { ...(show.externalIds ?? {}), ...(episodeMeta.externalIds ?? {}) };
    if (!Object.keys(externalIds).length) qcWarnings.push('No IMDb/TMDb/TVDB identifier; external enrichment and subtitle matching are limited');
    if (!editorialMarkers.some((marker) => marker.kind === 'credits' && marker.confidence >= .7)) qcWarnings.push('No reliable credits marker; automatic credits shortening is disabled');
    for (const language of allowedLanguages) if (!uniqueSubtitles.some((track) => track.language === language)) qcWarnings.push(`Missing ${language} subtitles`);
    const item: MediaItem = {
      id: episodeMeta.id ?? stableId(showId, episodeMeta.season ?? parsed.season ?? '', episodeMeta.episode ?? parsed.episode ?? '', path.basename(mediaPath)),
      showId,
      showTitle,
      showDescription: show.description ?? '',
      ...(defaultLanguage ? { defaultLanguage } : {}),
      weight: show.weight ?? 1,
      ...(season !== undefined ? { season } : {}),
      ...(episode !== undefined ? { episode } : {}),
      episodeTitle,
      description,
      mediaPath: path.resolve(mediaPath),
      durationMs,
      ...(audioLanguage ? { audioLanguage } : {}),
      subtitles: uniqueSubtitles,
      technical: { format: probe.format, streams: probe.streams, chapters: probe.chapters ?? [] },
      enabled: episodeMeta.enabled ?? show.enabled ?? true,
      externalIds,
      editorialMarkers,
      creditsPolicy: episodeMeta.creditsPolicy ?? show.creditsPolicy ?? 'shorten',
      effectiveEditorialDurationMs,
      breakpoints,
      ingestState: qcWarnings.length ? 'review' : 'ready',
      qcWarnings,
    };
    if (!item.showId || !item.showTitle || !item.episodeTitle) throw new Error(`Incomplete metadata for ${mediaPath}`);
    if (!Number.isFinite(item.weight) || item.weight <= 0) throw new Error(`Show weight must be positive for ${mediaPath}`);
    items.push(item);
  }
  return items;
}
