import type { Language } from './model.js';
import path from 'node:path';
import fs from 'node:fs';

export type FailureKind = 'network' | 'http' | 'extractor' | 'geo-restricted' | 'unavailable' | 'drm' | 'missing-tab';

/** Only fixed categories leave the process boundary; provider stderr stays private. */
export class AcquisitionCommandError extends Error {
  constructor(readonly kind: FailureKind, readonly httpStatus?: number) {
    super(`Downloader ${kind}${httpStatus ? ` (HTTP ${httpStatus})` : ''}; ${
      ['geo-restricted', 'unavailable', 'drm'].includes(kind) ? 'manual acquisition required' : 'retry scheduled'}`);
    this.name = 'AcquisitionCommandError';
  }
  get permanent(): boolean { return ['geo-restricted', 'unavailable', 'drm'].includes(this.kind); }
}

export function downloaderFailure(stderr: string): AcquisitionCommandError {
  if (/channel does not have a .*tab/i.test(stderr)) return new AcquisitionCommandError('missing-tab');
  if (/not available in your (?:country|region)|geo.?restrict|UNSUPPORTED_GEOLOCATION/i.test(stderr))
    return new AcquisitionCommandError('geo-restricted');
  if (/DRM protected|no supported non-DRM formats|only DRM/i.test(stderr))
    return new AcquisitionCommandError('drm');
  if (/video (?:is private|has been removed)|private video|episode is unavailable|video is unavailable/i.test(stderr))
    return new AcquisitionCommandError('unavailable');
  const status = /(?:HTTP Error|HTTP error|HTTP status)\s*:?\s*(\d{3})/i.exec(stderr)?.[1];
  if (status) return new AcquisitionCommandError('http', Number(status));
  if (/timed?\s*out|name resolution|connection|network|unable to download/i.test(stderr))
    return new AcquisitionCommandError('network');
  return new AcquisitionCommandError('extractor');
}

export function extractorArgs(source: string, projectRoot: string): string[] {
  if (source === 'ct') return [
    '--plugin-dirs', path.join(projectRoot, 'tools/yt-dlp-plugins'), '--use-extractors', 'LkpCeskaTelevize',
  ];
  if (source === 'youtube') return [
    '--js-runtimes', `deno:${path.join(projectRoot, 'runtime/tools/deno/deno')}`,
    '--remote-components', 'ejs:github',
    '--cache-dir', path.join(projectRoot, 'runtime/acquisition/yt-dlp-cache'),
  ];
  return [];
}

interface EpisodeIdentity { season?: number; episode?: number }
const episodeNumber = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

export function applyEpisodeIdentity(
  candidate: EpisodeIdentity, subscription: { defaultSeason?: number },
  metadata: { episode_number?: number; season_number?: number },
): void {
  if (episodeNumber(metadata.episode_number)) candidate.episode = metadata.episode_number;
  const season = metadata.season_number ?? subscription.defaultSeason;
  if (episodeNumber(season)) candidate.season = season;
}

export function preserveEpisodeIdentity(previous: EpisodeIdentity, next: EpisodeIdentity): void {
  if (next.episode === undefined && episodeNumber(previous.episode)) next.episode = previous.episode;
  if (next.season === undefined && episodeNumber(previous.season)) next.season = previous.season;
}

interface YoutubeSubscription {
  id: string; language: string; urls: string[]; channelId?: string;
  minDuration: number; maxDuration: number;
  title?: string; editorialClassification?: boolean;
}
interface PlaylistEntry {
  id?: string; title?: string; duration?: number; channel_id?: string;
  availability?: string; live_status?: string;
  url?: string; description?: string; timestamp?: number; release_timestamp?: number;
}
interface Playlist {
  id?: string; channel_id?: string; entries?: PlaylistEntry[];
}
export interface YoutubeCandidate {
  source: 'youtube'; sourceId: string; sourceUrl: string; showId: string; title: string;
  language: Language; description: string; descriptionLanguage: string;
  durationMs: number; size: number; broadcaster: string; components: string[];
  compilation: boolean; format: 'episode'; available: boolean;
  originalTitle?: string; publishedAt?: number; invalidReason?: string;
}
type Execute = (binary: string, args: string[], guard?: () => void, timeout?: number) => Promise<string>;
// Resolution wins over codec: a 1080p VP9 source beats a 360p H.264 source.
export const educationalYoutubeFormat = 'bv*[height>=480][height<=1080]+ba/b[height>=480][height<=1080]';
export const youtubeQualityArgs = ['-f', educationalYoutubeFormat, '--format-sort-force', '-S', 'height,vcodec:h264'];
export function acceptableAcquisitionHeight(height: unknown): boolean {
  return typeof height === 'number' && Number.isFinite(height) && height >= 480;
}
export function youtubeEstimatedBytes(metadata: { filesize?: number; filesize_approx?: number; requested_formats?: Array<{ filesize?: number; filesize_approx?: number }> }, durationMs: number): number {
  const formats = metadata.requested_formats ?? [metadata];
  const sizes = formats.map(f => Number(f.filesize ?? f.filesize_approx));
  return sizes.length && sizes.every(n => Number.isFinite(n) && n > 0)
    ? Math.ceil(sizes.reduce((a, b) => a + b, 0) * 1.05) : Math.ceil(durationMs / 1000 * 1_500_000);
}

export function validateYoutubeSubscription(s: YoutubeSubscription): void {
  if (s.editorialClassification) {
    if (!/^UC[\w-]{22}$/.test(s.channelId ?? '') || !['de', 'en'].includes(s.language) ||
      s.urls.length !== 3 || !['videos', 'streams', 'shorts'].every(tab =>
        s.urls.includes(`https://www.youtube.com/channel/${s.channelId}/${tab}`)))
      throw new Error('Educational YouTube discovery requires the pinned official channel tabs');
    return;
  }
  if (!/^UC[\w-]{22}$/.test(s.channelId ?? '') || !s.urls.length || s.language !== 'en')
    throw new Error('YouTube subscription requires an approved English channel and playlist');
  for (const value of s.urls) {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'www.youtube.com' || u.pathname !== '/playlist' ||
      !/^PL[\w-]+$/.test(u.searchParams.get('list') ?? '') || [...u.searchParams.keys()].some(k => k !== 'list'))
      throw new Error('YouTube discovery requires an explicit canonical playlist URL');
  }
}

export function playlistCandidates(data: Playlist, s: YoutubeSubscription): YoutubeCandidate[] {
  if (data.channel_id !== s.channelId || !Array.isArray(data.entries))
    throw new Error('YouTube playlist does not belong to the approved channel');
  const seen = new Set<string>();
  return data.entries.flatMap<YoutubeCandidate>(e => {
    if (s.editorialClassification) {
      if (!e.id || !/^[\w-]{11}$/.test(e.id) || seen.has(e.id) || !e.title) return [];
      if (e.channel_id && e.channel_id !== s.channelId) throw new Error('Channel entry identity mismatch');
      seen.add(e.id);
      const invalidReason = (e.availability && !['public', 'unlisted'].includes(e.availability)) ? 'Source unavailable'
        : (e.live_status && e.live_status !== 'not_live') ? 'Livestream or live replay'
        : /\/shorts\//.test(e.url ?? '') ? 'YouTube Short'
        : /\b(?:trailer|teaser|preview|vorschau)\b/i.test(e.title) ? 'Trailer or preview' : undefined;
      const duration = Number(e.duration) > 0 ? Number(e.duration) : 0;
      return [{ source: 'youtube' as const, sourceId: e.id, sourceUrl: `https://www.youtube.com/watch?v=${e.id}`,
        showId: s.id, title: e.title, originalTitle: e.title, language: s.language as Language,
        description: (e.description ?? '').slice(0, 1800), descriptionLanguage: s.language,
        durationMs: Math.round(duration * 1000), size: Math.max(1, Math.ceil(duration * 1_500_000)),
        broadcaster: `YouTube: ${s.title ?? s.id}`, components: [], compilation: false,
        format: 'episode' as const, available: !invalidReason,
        ...((e.timestamp ?? e.release_timestamp) ? { publishedAt: (e.timestamp ?? e.release_timestamp)! * 1000 } : {}),
        ...(invalidReason ? { invalidReason } : {}) }];
    }
    if (!e.id || !/^[\w-]{11}$/.test(e.id) || seen.has(e.id) || !e.title ||
      !Number.isFinite(e.duration) || e.duration! < s.minDuration || e.duration! > s.maxDuration ||
      (e.channel_id && e.channel_id !== s.channelId) ||
      (e.availability && !['public', 'unlisted'].includes(e.availability)) ||
      (e.live_status && e.live_status !== 'not_live') ||
      /\b(?:clip|trailer|preview|teaser|compilation|pack|hours?)\b|\b\d+\s*[-–]\s*\d+\b/i.test(e.title)) return [];
    seen.add(e.id);
    return [{
      source: 'youtube' as const, sourceId: e.id, sourceUrl: `https://www.youtube.com/watch?v=${e.id}`,
      showId: s.id, title: e.title, language: s.language as Language, description: '', descriptionLanguage: s.language,
      durationMs: Math.round(e.duration! * 1000), size: Math.ceil(e.duration! * 1_500_000),
      broadcaster: 'YouTube: Teletubbies - WildBrain', components: [], compilation: false,
      format: 'episode' as const, available: true as const,
    }];
  });
}

export async function discoverYoutube(
  s: YoutubeSubscription, limit: number, downloader: string, execute: Execute, guard: () => void,
): Promise<YoutubeCandidate[]> {
  validateYoutubeSubscription(s);
  const result = new Map<string, YoutubeCandidate>();
  for (const url of s.urls) {
    let data: Playlist;
    try { data = JSON.parse(await execute(downloader, [
      '--ignore-config', '--flat-playlist', '--dump-single-json', '--no-warnings',
      '--socket-timeout', '20', '--retries', '2', ...(s.editorialClassification ? [] : ['--playlist-end', String(limit)]), url,
    ], guard, 120_000)) as Playlist; }
    catch (error) {
      if (s.editorialClassification && !url.endsWith('/videos') && error instanceof AcquisitionCommandError && error.kind === 'missing-tab') continue;
      throw error;
    }
    if (s.editorialClassification) for (const entry of data.entries ?? []) {
      if (url.endsWith('/streams')) entry.live_status = 'was_live';
      if (url.endsWith('/shorts')) entry.url = `https://www.youtube.com/shorts/${entry.id}`;
    }
    for (const c of playlistCandidates(data, s)) if (!result.has(c.sourceId)) result.set(c.sourceId, c);
  }
  return [...result.values()];
}

interface RecoverableStore {
  state(key: string): string | undefined;
  set(key: string, value: string): void;
  candidates(states: string[]): Array<{ id: string; metadata: SourceCandidate; reason: string }>;
  transition(id: string, state: string, reason: string): void;
  catalogue: { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } };
}

/** Requeue only failures from the retired ČT extractor, once per adapter migration. */
export function recoverCtExtraction(store: RecoverableStore): void {
  const key = 'ct-player-api-v1-recovery';
  if (store.state(key)) return;
  for (const row of store.candidates(['manual'])) {
    if (row.metadata.source !== 'ct' ||
      row.reason !== 'ČT detected episode needs manual acquisition: extractor unavailable or access restricted') continue;
    store.catalogue.db.prepare('UPDATE acquisition_candidates SET attempts=0 WHERE id=?').run(row.id);
    store.transition(row.id, 'discovered', 'Retry using the current ČT player API');
  }
  store.set(key, '1');
}

interface SourceCandidate { source: string; broadcaster?: string }

export function isOrf(candidate: SourceCandidate): boolean {
  return candidate.source === 'mediathek' && /\bORF\b/i.test(candidate.broadcaster ?? '');
}

export function usesStreamExtractor(candidate: SourceCandidate): boolean {
  return ['ct', 'youtube'].includes(candidate.source) || isOrf(candidate);
}

/** The old direct downloader left text playlists under completed MP4 names. */
export function discardOrfPlaylistFiles(directory: string): void {
  for (const name of ['source.mp4', 'source.mp4.part']) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) continue;
    const fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(7);
    try { fs.readSync(fd, header, 0, 7, 0); } finally { fs.closeSync(fd); }
    if (header.toString() !== '#EXTM3U') continue;
    fs.rmSync(file);
    fs.rmSync(`${file}.resume.json`, { force: true });
  }
}

/** Retry only the generic failures produced by the old ORF direct-file path. */
export function recoverOrfExtraction(store: RecoverableStore): void {
  const key = 'orf-hls-v1-recovery';
  if (store.state(key)) return;
  for (const row of store.candidates(['manual', 'deferred'])) {
    if (!isOrf(row.metadata) || ![
      'Repeated processing failures; manual preparation required',
      'Acquisition processing failed; retry scheduled',
    ].includes(row.reason)) continue;
    store.catalogue.db.prepare('UPDATE acquisition_candidates SET attempts=0 WHERE id=?').run(row.id);
    store.transition(row.id, 'discovered', 'Retry using the ORF streaming extractor');
  }
  store.set(key, '1');
}
