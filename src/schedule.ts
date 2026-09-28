import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import type { AdAsset, AppConfig, MediaItem, ScheduleEntry } from './types.js';
import { LkpDatabase } from './database.js';
import { reconcileIntermissions, isProgramme, readRotationLibrary, type RotationClip } from './intermissions/rotation.js';
import { buildPlayoutPlan, type AdBumper } from './editorial.js';
import { stableId } from './util.js';

interface ShowBucket { id: string; weight: number; episodes: MediaItem[] }
interface SchedulePlanning { config: AppConfig; ads: AdAsset[]; clips: RotationClip[]; bumpers: AdBumper[] }

function deterministicUnit(seed: string, sequence: number, showId: string): number {
  const bytes = crypto.createHash('sha256').update(`${seed}\0${sequence}\0${showId}`).digest();
  return (bytes.readUInt32BE(0) + 1) / 0x1_0000_0001;
}

function readBumpers(config: AppConfig): AdBumper[] {
  const manifest = config.advertising?.bumperManifest;
  if (!manifest || !fs.existsSync(manifest)) return [];
  const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version?: number; bumpers?: AdBumper[] };
  if (parsed.version !== 1 || !Array.isArray(parsed.bumpers)) throw new Error('Invalid WERBUNG bumper manifest');
  return parsed.bumpers.filter((bumper) => Number.isSafeInteger(bumper.durationMs) && bumper.durationMs > 0 && fs.existsSync(bumper.mediaPath));
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
  initialSequence = 0, previousEntries: ScheduleEntry[] = [], planning?: SchedulePlanning,
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
  for (const entry of previousEntries.filter(isProgramme)) playedByShow.set(entry.showId, (playedByShow.get(entry.showId) ?? 0) + 1);

  let cursor = startMs;
  let sequence = initialSequence;
  let programmeOrdinal = previousEntries.filter(isProgramme).length;
  let previousShow = previousEntries.filter(isProgramme).at(-1)?.showId;
  const result: ScheduleEntry[] = [];
  while (cursor < targetEndMs) {
    const show = chooseShow(shows, seed, sequence, previousShow);
    const playCount = playedByShow.get(show.id) ?? 0;
    const media = show.episodes[playCount % show.episodes.length]!;
    const startsAtMs = cursor;
    const id = stableId(seed, sequence, media.id, startsAtMs);
    const playoutPlan = planning ? buildPlayoutPlan({
      eventId: id, eventStartMs: startsAtMs, media, ...(planning.config.advertising ? { advertising: planning.config.advertising } : {}),
      ads: planning.ads, bumpers: planning.bumpers, intermissions: planning.clips, seed, programmeOrdinal,
    }) : undefined;
    const durationMs = playoutPlan?.durationMs ?? media.durationMs;
    const endsAtMs = startsAtMs + durationMs;
    result.push({
      id, sequence, mediaId: media.id, showId: media.showId,
      showTitle: media.showTitle, ...(media.season !== undefined ? { season: media.season } : {}),
      ...(media.episode !== undefined ? { episode: media.episode } : {}), episodeTitle: media.episodeTitle,
      description: media.description, startsAtMs, endsAtMs, durationMs, mediaPath: media.mediaPath,
      ...(media.audioLanguage ? { audioLanguage: media.audioLanguage } : {}),
      subtitleLanguages: [...new Set(media.subtitles.map((subtitle) => subtitle.language))].sort(),
      listingVisibility: 'public', ...(playoutPlan ? { playoutPlan } : {}),
    });
    playedByShow.set(show.id, playCount + 1);
    previousShow = show.id;
    cursor = endsAtMs;
    sequence += 1;
    programmeOrdinal += 1;
  }
  return result;
}

export function reconcilePlayoutPlans(db: LkpDatabase, config: AppConfig, earliestMs = Date.now() + 60_000): number {
  const bounds = db.scheduleBounds();
  if (!bounds) return 0;
  const entries = db.listSchedule(earliestMs, bounds.lastMs + 1).filter((entry) => entry.startsAtMs >= earliestMs);
  if (!entries.length) return 0;
  const mediaById = new Map(db.listMedia(false).map((media) => [media.id, media]));
  const planning: SchedulePlanning = { config, ads: db.listAds(), clips: readRotationLibrary(config), bumpers: readBumpers(config) };
  const before = db.listSchedule(bounds.firstMs, entries[0]!.startsAtMs);
  let programmeOrdinal = before.filter(isProgramme).length;
  let cursor = entries[0]!.startsAtMs;
  let changed = 0;
  const planned = entries.map((entry) => {
    let plan = entry.playoutPlan;
    if (isProgramme(entry)) {
      const media = mediaById.get(entry.mediaId);
      if (media && !plan) {
        plan = buildPlayoutPlan({ eventId: entry.id, eventStartMs: cursor, media, ...(config.advertising ? { advertising: config.advertising } : {}), ads: planning.ads, bumpers: planning.bumpers, intermissions: planning.clips, seed: config.schedule.seed, programmeOrdinal });
        changed += 1;
      }
      programmeOrdinal += 1;
    }
    const durationMs = plan?.durationMs ?? entry.durationMs;
    const next = {
      ...entry, startsAtMs: cursor, endsAtMs: cursor + durationMs, durationMs,
      ...(plan ? { playoutPlan: plan } : {}),
      listingVisibility: entry.showId === 'lkp-weather' || !entry.showId.startsWith('lkp-') ? 'public' as const : 'hidden' as const,
    };
    cursor = next.endsAtMs;
    return next;
  });
  for (const entry of planned.filter((candidate) => candidate.showId === 'lkp-weather')) {
    const metadata = path.join(path.dirname(entry.mediaPath), 'programme.json');
    if (fs.existsSync(metadata)) {
      const validUntil = Date.parse((JSON.parse(fs.readFileSync(metadata, 'utf8')) as { validUntil: string }).validUntil);
      if (Number.isFinite(validUntil) && entry.endsAtMs > validUntil) throw new Error(`Playout-plan migration would move weather beyond validity: ${entry.id}`);
    }
  }
  if (!changed && planned.every((entry, index) => entry.startsAtMs === entries[index]!.startsAtMs && entry.listingVisibility === entries[index]!.listingVisibility)) return 0;
  const update = db.db.prepare('UPDATE schedule_entries SET starts_at_ms=?,ends_at_ms=?,duration_ms=?,listing_visibility=?,playout_plan_json=? WHERE id=?');
  db.db.transaction(() => {
    for (let index = planned.length - 1; index >= 0; index -= 1) {
      const entry = planned[index]!;
      update.run(entry.startsAtMs, entry.endsAtMs, entry.durationMs, entry.listingVisibility, entry.playoutPlan ? JSON.stringify(entry.playoutPlan) : null, entry.id);
    }
  }).immediate();
  return changed;
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
  if (existing && existing.lastMs >= targetEnd) {
    const added=reconcileIntermissions(db,config);
    const bounds=db.scheduleBounds()!;
    return {added,firstMs:bounds.firstMs,lastMs:bounds.lastMs};
  }
  const previous = existing ? db.listSchedule(existing.firstMs, existing.lastMs + 1) : [];
  const last = previous.at(-1);
  const startMs = last?.endsAtMs ?? requestedStart;
  const sequence = last ? last.sequence + 1 : 0;
  const planning: SchedulePlanning = { config, ads: db.listAds(), clips: readRotationLibrary(config), bumpers: readBumpers(config) };
  const entries = buildScheduleEntries(db.listMedia(), config.schedule.seed, startMs, targetEnd, sequence, previous, planning);
  db.insertSchedule(entries);
  const intermissions = reconcileIntermissions(db, config);
  const bounds = db.scheduleBounds()!;
  return { added: entries.length + intermissions, firstMs: bounds.firstMs, lastMs: bounds.lastMs };
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
