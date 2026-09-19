import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import type { AppConfig, MediaItem, ScheduleEntry } from './types.js';
import { LkpDatabase } from './database.js';
import { stableId } from './util.js';

interface ShowBucket { id: string; weight: number; episodes: MediaItem[] }

function deterministicUnit(seed: string, sequence: number, showId: string): number {
  const bytes = crypto.createHash('sha256').update(`${seed}\0${sequence}\0${showId}`).digest();
  return (bytes.readUInt32BE(0) + 1) / 0x1_0000_0001;
}

function chooseShow(shows: ShowBucket[], seed: string, sequence: number, previousShow?: string): ShowBucket {
  const eligible = shows.length > 1 ? shows.filter((show) => show.id !== previousShow) : shows;
  return eligible.reduce((best, candidate) => {
    const score = -Math.log(deterministicUnit(seed, sequence, candidate.id)) / candidate.weight;
    return !best || score < best.score ? { show: candidate, score } : best;
  }, undefined as { show: ShowBucket; score: number } | undefined)!.show;
}

export function buildScheduleEntries(
  catalogue: MediaItem[], seed: string, startMs: number, targetEndMs: number,
  initialSequence = 0, previousEntries: ScheduleEntry[] = [],
): ScheduleEntry[] {
  const enabled = catalogue.filter((item) => item.enabled);
  if (enabled.length === 0) throw new Error('Cannot generate a schedule without enabled media');
  const byShow = new Map<string, ShowBucket>();
  for (const item of enabled) {
    const bucket = byShow.get(item.showId) ?? { id: item.showId, weight: item.weight, episodes: [] };
    if (bucket.weight !== item.weight) throw new Error(`Inconsistent scheduling weights for show ${item.showId}`);
    bucket.episodes.push(item);
    byShow.set(item.showId, bucket);
  }
  const shows = [...byShow.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const show of shows) show.episodes.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) || a.id.localeCompare(b.id));
  const playedByShow = new Map<string, number>();
  for (const entry of previousEntries) playedByShow.set(entry.showId, (playedByShow.get(entry.showId) ?? 0) + 1);

  let cursor = startMs;
  let sequence = initialSequence;
  let previousShow = previousEntries.at(-1)?.showId;
  const result: ScheduleEntry[] = [];
  while (cursor < targetEndMs) {
    const show = chooseShow(shows, seed, sequence, previousShow);
    const playCount = playedByShow.get(show.id) ?? 0;
    const media = show.episodes[playCount % show.episodes.length]!;
    const startsAtMs = cursor;
    const endsAtMs = startsAtMs + media.durationMs;
    result.push({
      id: stableId(seed, sequence, media.id, startsAtMs), sequence, mediaId: media.id, showId: media.showId,
      showTitle: media.showTitle, ...(media.season !== undefined ? { season: media.season } : {}),
      ...(media.episode !== undefined ? { episode: media.episode } : {}), episodeTitle: media.episodeTitle,
      description: media.description, startsAtMs, endsAtMs, durationMs: media.durationMs, mediaPath: media.mediaPath,
      ...(media.audioLanguage ? { audioLanguage: media.audioLanguage } : {}),
      subtitleLanguages: [...new Set(media.subtitles.map((s) => s.language))].sort(),
    });
    playedByShow.set(show.id, playCount + 1);
    previousShow = show.id;
    cursor = endsAtMs;
    sequence += 1;
  }
  return result;
}

export function ensureSchedule(
  db: LkpDatabase, config: AppConfig, options: { fromMs?: number; horizonDays?: number; force?: boolean } = {},
): { added: number; firstMs: number; lastMs: number } {
  if (options.force) db.clearSchedule();
  const now = Date.now();
  const existing = db.scheduleBounds();
  const zone = config.channel.timezone;
  const requestedStart = options.fromMs ?? DateTime.fromMillis(now, { zone }).startOf('day').toMillis();
  const horizonDays = options.horizonDays ?? config.schedule.horizonDays;
  const targetEnd = DateTime.fromMillis(Math.max(now, requestedStart), { zone }).plus({ days: horizonDays }).endOf('day').toMillis();
  if (existing && existing.lastMs >= targetEnd) return { added: 0, firstMs: existing.firstMs, lastMs: existing.lastMs };
  const previous = existing ? db.listSchedule(existing.firstMs, existing.lastMs + 1) : [];
  const last = previous.at(-1);
  const startMs = last?.endsAtMs ?? requestedStart;
  const sequence = last ? last.sequence + 1 : 0;
  const entries = buildScheduleEntries(db.listMedia(), config.schedule.seed, startMs, targetEnd, sequence, previous);
  db.insertSchedule(entries);
  const bounds = db.scheduleBounds()!;
  return { added: entries.length, firstMs: bounds.firstMs, lastMs: bounds.lastMs };
}

export function validateTimeline(entries: ScheduleEntry[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (entry.endsAtMs - entry.startsAtMs !== entry.durationMs) errors.push(`${entry.id}: duration does not match boundaries`);
    const previous = entries[i - 1];
    if (previous && previous.endsAtMs !== entry.startsAtMs) errors.push(`${entry.id}: ${previous.endsAtMs < entry.startsAtMs ? 'gap' : 'overlap'} before entry`);
  }
  return errors;
}
