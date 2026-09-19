import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parse } from 'yaml';
import type { AppConfig, MediaItem, SubtitleTrack } from './types.js';
import { normalizeLanguage, stableId } from './util.js';

interface ShowMetadata {
  id?: string;
  title?: string;
  description?: string;
  language?: string;
  weight?: number;
  enabled?: boolean;
}

interface EpisodeMetadata {
  id?: string;
  title?: string;
  description?: string;
  season?: number;
  episode?: number;
  enabled?: boolean;
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
}

function readYaml<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  const value = parse(fs.readFileSync(file, 'utf8')) as T;
  if (!value || typeof value !== 'object') throw new Error(`Metadata must contain an object: ${file}`);
  return value;
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

async function ffprobe(binary: string, file: string): Promise<ProbeResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] });
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
    else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) result.push(full);
  }
  return result.sort((a, b) => a.localeCompare(b, 'cs'));
}

function discoverSidecars(mediaPath: string, allowed: Set<string>): SubtitleTrack[] {
  const dir = path.dirname(mediaPath);
  const stem = path.basename(mediaPath, path.extname(mediaPath));
  const tracks: SubtitleTrack[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^${escaped}\\.([a-z]{2,3})\\.(srt|ass)$`, 'i').exec(entry.name);
    if (!match) continue;
    const language = normalizeLanguage(match[1]);
    if (language && allowed.has(language)) tracks.push({ language, kind: 'sidecar', path: path.join(dir, entry.name), codec: match[2]!.toLowerCase() });
  }
  return tracks;
}

export async function scanMedia(config: AppConfig, onProgress?: (message: string) => void): Promise<MediaItem[]> {
  if (!fs.existsSync(config.media.root)) throw new Error(`Media root does not exist: ${config.media.root}`);
  const mediaFiles = walk(config.media.root, new Set(config.media.supportedExtensions));
  if (mediaFiles.length === 0) throw new Error(`No supported media found below ${config.media.root}`);
  const allowedLanguages = new Set(config.media.subtitleLanguages);
  const items: MediaItem[] = [];

  for (const mediaPath of mediaFiles) {
    onProgress?.(`Probing ${path.relative(config.media.root, mediaPath)}`);
    const directory = path.dirname(mediaPath);
    const relativeDirectory = path.relative(config.media.root, directory);
    const show = readYaml<ShowMetadata>(path.join(directory, 'show.yaml')) ?? {};
    const stem = mediaPath.slice(0, -path.extname(mediaPath).length);
    const episodeMeta = readYaml<EpisodeMetadata>(`${stem}.yaml`) ?? {};
    const parsed = parseEpisodeFilename(path.basename(mediaPath));
    const probe = await ffprobe(config.media.ffprobe, mediaPath);
    const durationSeconds = Number(probe.format.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error(`No valid duration detected for ${mediaPath}`);
    const showId = show.id ?? (relativeDirectory.split(path.sep).filter(Boolean).join('-') || 'uncategorized');
    const showTitle = show.title ?? titleFromSlug(path.basename(directory === config.media.root ? showId : directory));
    const episodeTitle = episodeMeta.title ?? parsed.title;
    const description = episodeMeta.description ?? show.description ?? '';
    const subtitles = discoverSidecars(mediaPath, allowedLanguages);
    for (const stream of probe.streams.filter((s) => s.codec_type === 'subtitle')) {
      const language = normalizeLanguage(stream.tags?.language);
      if (language && allowedLanguages.has(language)) subtitles.push({
        language, kind: stream.codec_name === 'dvb_subtitle' ? 'dvb-bitmap' : 'embedded', streamIndex: stream.index,
        ...(stream.codec_name ? { codec: stream.codec_name } : {}),
      });
    }
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    const uniqueSubtitles = subtitles.filter((track, i) => subtitles.findIndex((other) => other.language === track.language && other.kind === track.kind && other.path === track.path && other.streamIndex === track.streamIndex) === i);
    const defaultLanguage = normalizeLanguage(show.language);
    const season = episodeMeta.season ?? parsed.season;
    const episode = episodeMeta.episode ?? parsed.episode;
    const audioLanguage = normalizeLanguage(audio?.tags?.language ?? show.language);
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
      durationMs: Math.round(durationSeconds * 1000),
      ...(audioLanguage ? { audioLanguage } : {}),
      subtitles: uniqueSubtitles,
      technical: { format: probe.format, streams: probe.streams },
      enabled: episodeMeta.enabled ?? show.enabled ?? true,
    };
    if (!item.showId || !item.showTitle || !item.episodeTitle) throw new Error(`Incomplete metadata for ${mediaPath}`);
    if (!Number.isFinite(item.weight) || item.weight <= 0) throw new Error(`Show weight must be positive for ${mediaPath}`);
    items.push(item);
  }
  return items;
}
