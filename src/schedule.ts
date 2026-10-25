import { buildChildrenSchedule } from './children-schedule.js';
import { validateAge } from './children-policy.js';
import { childrenSettings, saveChildrenAge } from './children-settings.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import type { AdAsset, AppConfig, MediaItem, ScheduleEntry } from './types.js';
import { LkpDatabase } from './database.js';
import { chooseIntermission, reconcileIntermissions, isProgramme, readRotationLibrary, intermissionShowId, type RotationClip } from './intermissions/rotation.js';
import { buildPlayoutPlan, type AdBumper } from './editorial.js';
import { stableId } from './util.js';
import { ordinaryProgramme, programmeOrder, programmeRotation } from './acquisition/programming.js';
import { eligibleFor } from './channels.js';
import { buildProfileSchedule, type RotationRecord } from './channel-schedule.js';

interface ShowBucket { id: string; weight: number; episodes: MediaItem[] }
export interface SchedulePlanning { config: AppConfig; ads: AdAsset[]; clips: RotationClip[]; bumpers: AdBumper[]; partitionEndMs?: number; history?: RotationRecord[]; reserved?: ScheduleEntry[] }
export function schedulePlanning(db: LkpDatabase, config: AppConfig): SchedulePlanning {
  childrenSettings(db,config);
  return { config, ads: db.listAds(), clips: readRotationLibrary(config), bumpers: readBumpers(config),
    history: db.db.prepare('SELECT media_id AS mediaId,played_count AS count,last_played_at_ms AS lastAtMs FROM media_rotation_history').all() as RotationRecord[] };
}

// Feature films get one Saturday-evening premiere and the same film on Sunday
// morning. The next ordinary programme boundary starts the film, so no show is
// cut short to hit a wall-clock minute.
export const featureMinimumDurationMs = 60 * 60_000;
const DAY_MS = 86_400_000;

function featureWindow(atMs: number, zone: string): { date: string; week: string; weekday: number } | undefined {
  const local = DateTime.fromMillis(atMs, { zone });
  const inWindow = local.weekday === 6 ? local.hour >= 18 && local.hour < 20
    : local.weekday === 7 && local.hour >= 9 && local.hour < 11;
  if (!inWindow) return undefined;
  return { date: local.toISODate()!, week: local.startOf('week').toISODate()!, weekday: local.weekday };
}

function filmForWeek(films: MediaItem[], monday: string): MediaItem {
  // Calendar dates in UTC keep weekly rotation stable across Prague DST changes.
  const weekIndex = Math.floor(DateTime.fromISO(monday, { zone: 'UTC' }).toMillis() / (7 * DAY_MS));
  return films[((weekIndex % films.length) + films.length) % films.length]!;
}

function deterministicUnit(seed: string, sequence: number, showId: string): number {
  const bytes = crypto.createHash('sha256').update(`${seed}\0${sequence}\0${showId}`).digest();
  return (bytes.readUInt32BE(0) + 1) / 0x1_0000_0001;
}

export function readBumpers(config: AppConfig): AdBumper[] {
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
  if (planning?.config.station?.enabled && planning.partitionEndMs === undefined) {
    return buildProfileSchedule(catalogue, seed, startMs, targetEndMs, initialSequence, previousEntries, planning,
      (from, until, sequence, previous) => buildScheduleEntries(catalogue, seed, from, until, sequence, previous, { ...planning, partitionEndMs: until }));
  }
  if (planning?.config.children?.enabled) return buildChildrenSchedule(catalogue,seed,startMs,targetEndMs,initialSequence,previousEntries,planning.config,planning);
  const enabled = catalogue.filter((item) => eligibleFor(item, 'lkp', planning?.config.station, startMs));
  if (enabled.length === 0) throw new Error('Cannot generate a schedule without enabled media');
  const byShow = new Map<string, ShowBucket>();
  for (const item of enabled) {
    const bucket = byShow.get(item.showId) ?? { id: item.showId, weight: item.weight, episodes: [] };
    if (bucket.weight !== item.weight) throw new Error(`Inconsistent scheduling weights for show ${item.showId}`);
    bucket.episodes.push(item);
    byShow.set(item.showId, bucket);
  }
  const films = enabled.filter((item) => !ordinaryProgramme(item, featureMinimumDurationMs))
    .sort((a, b) => a.id.localeCompare(b.id));
  const filmById = new Map(films.map((film) => [film.id, film]));
  const shows = [...byShow.values()]
    .map((show) => ({ ...show, episodes: show.episodes.filter((item) => ordinaryProgramme(item, featureMinimumDurationMs)) }))
    .filter((show) => show.episodes.length)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!shows.length) throw new Error('At least one programme shorter than an hour is required between weekend films');
  for (const show of shows) show.episodes.sort(programmeOrder);
  const zone = planning?.config.channel.timezone ?? 'Europe/Prague';
  const featuredDates = new Set<string>();
  const saturdayFilmByWeek = new Map<string, string>();
  for (const entry of previousEntries) {
    if (!filmById.has(entry.mediaId)) continue;
    const local = DateTime.fromMillis(entry.startsAtMs, { zone });
    featuredDates.add(local.toISODate()!);
    if (local.weekday === 6) saturdayFilmByWeek.set(local.startOf('week').toISODate()!, entry.mediaId);
  }
  const playedByShow = new Map<string, number>();
  for (const entry of previousEntries.filter(isProgramme)) playedByShow.set(entry.showId, (playedByShow.get(entry.showId) ?? 0) + 1);

  const spokenMs = new Map<string, number>();
  const languageByMedia = new Map(enabled.map(m => [m.id, m.audioLanguage ?? m.defaultLanguage]));
  for (const entry of previousEntries) {
    const language = languageByMedia.get(entry.mediaId) ?? entry.audioLanguage;
    if (language && ['de','en','cs'].includes(language)) spokenMs.set(language,(spokenMs.get(language) ?? 0)+entry.durationMs);
  }
  let cursor = startMs;
  let sequence = initialSequence;
  let programmeOrdinal = previousEntries.filter(isProgramme).length;
  let previousShow = previousEntries.filter(isProgramme).at(-1)?.showId;
  let previousClip = previousEntries.filter((entry) => entry.showId === intermissionShowId).at(-1)?.mediaId.replace(/^intermission-/, '');
  const result: ScheduleEntry[] = [];
  while (cursor < targetEndMs) {
    const fits = (item: MediaItem) => !planning?.partitionEndMs || item.durationMs <= planning.partitionEndMs - cursor;
    const availableShows = shows.map(show => ({ ...show, episodes: programmeRotation(show.episodes, cursor, zone).filter(fits) })).filter(show => show.episodes.length);
    if (!availableShows.length && planning?.partitionEndMs) break;
    if (!availableShows.length) throw new Error('No season-appropriate ordinary programmes');
    const slot = films.length ? featureWindow(cursor, zone) : undefined;
    const possibleFilm = slot && !featuredDates.has(slot.date)
      ? slot.weekday === 7 ? filmById.get(saturdayFilmByWeek.get(slot.week) ?? '') ?? filmForWeek(films, slot.week)
        : filmForWeek(films, slot.week)
      : undefined;
    const selectedFilm = possibleFilm && fits(possibleFilm) ? possibleFilm : undefined;
    let show = selectedFilm ? undefined : chooseShow(availableShows, seed, sequence, previousShow);
    const targets = planning?.config.schedule.spokenLanguageTargets;
    if (show && targets && Object.hasOwn(targets, show.episodes[0]!.audioLanguage ?? show.episodes[0]!.defaultLanguage ?? '')) {
      const eligible = availableShows.length > 1 ? availableShows.filter(s => s.id !== previousShow) : availableShows;
      const total = [...spokenMs.values()].reduce((a,b)=>a+b,0);
      const languages = Object.keys(targets).filter(language => availableShows.some(s => (s.episodes[0]!.audioLanguage ?? s.episodes[0]!.defaultLanguage) === language));
      const chosen = languages.sort((a,b) => {
        const debt = (l:string) => (total + 10*60_000)*targets[l as keyof typeof targets] - (spokenMs.get(l) ?? 0);
        return debt(b)-debt(a) || a.localeCompare(b);
      })[0];
      if (chosen) {
        const matching = eligible.filter(s => (s.episodes[0]!.audioLanguage ?? s.episodes[0]!.defaultLanguage) === chosen);
        const neutral = eligible.filter(s => (s.episodes[0]!.audioLanguage ?? s.episodes[0]!.defaultLanguage) === 'zxx');
        // A neutral programme separates repeat shows when the desired language has only one show.
        if (matching.length || neutral.length) show = chooseShow(matching.length ? matching : neutral,seed,sequence);
      }
    }
    const playCount = playedByShow.get((selectedFilm ?? show!.episodes[0]!).showId) ?? 0;
    const media = selectedFilm ?? show!.episodes[playCount % show!.episodes.length]!;
    const startsAtMs = cursor;
    const id = stableId(seed, sequence, media.id, startsAtMs);
    let playoutPlan = planning ? buildPlayoutPlan({
      eventId: id, eventStartMs: startsAtMs, media, ...(planning.config.advertising ? { advertising: planning.config.advertising } : {}),
      ads: planning.ads, bumpers: planning.bumpers, intermissions: planning.clips, seed, programmeOrdinal,
    }) : undefined;
    if (planning?.partitionEndMs && playoutPlan && cursor + playoutPlan.durationMs > planning.partitionEndMs) {
      playoutPlan = buildPlayoutPlan({ eventId: id, eventStartMs: startsAtMs, media, ads: [], bumpers: [], intermissions: [], seed, programmeOrdinal });
    }
    const durationMs = playoutPlan?.durationMs ?? media.durationMs;
    const endsAtMs = startsAtMs + durationMs;
    const entry: ScheduleEntry = {
      id, sequence, mediaId: media.id, showId: media.showId,
      showTitle: media.showTitle, ...(media.season !== undefined ? { season: media.season } : {}),
      ...(media.episode !== undefined ? { episode: media.episode } : {}), episodeTitle: media.episodeTitle,
      description: media.description, startsAtMs, endsAtMs, durationMs, mediaPath: media.mediaPath,
      ...(media.audioLanguage ? { audioLanguage: media.audioLanguage } : {}),
      subtitleLanguages: [...new Set(media.subtitles.map((subtitle) => subtitle.language))].sort(),
      listingVisibility: 'public', ...(playoutPlan ? { playoutPlan } : {}),
    };
    result.push(entry);
    if (selectedFilm && slot) {
      featuredDates.add(slot.date);
      if (slot.weekday === 6) saturdayFilmByWeek.set(slot.week, selectedFilm.id);
    }
    playedByShow.set(media.showId, playCount + 1);
    previousShow = media.showId;
    cursor = endsAtMs;
    const language = media.audioLanguage ?? media.defaultLanguage;
    if (language && ['de', 'en', 'cs'].includes(language)) spokenMs.set(language, (spokenMs.get(language) ?? 0) + durationMs);
    sequence += 1;
    programmeOrdinal += 1;
    // Account for intermissions while choosing wall-clock feature slots. A
    // later bulk insertion would shift Saturday/Sunday films out of them.
    const policy = planning?.config.intermissions;
    if (policy && planning.clips.length && cursor < targetEndMs) {
      const clip = chooseIntermission(planning.clips, policy, seed, entry, cursor, previousClip);
      if (clip && (!planning?.partitionEndMs || cursor + clip.durationMs <= planning.partitionEndMs)) {
        result.push({ id: stableId('intermission-after', entry.id), sequence,
          mediaId: `intermission-${clip.id}`, showId: intermissionShowId,
          showTitle: 'Lundenburg Kids Premium', episodeTitle: clip.title,
          description: clip.synopsis, startsAtMs: cursor, endsAtMs: cursor + clip.durationMs,
          durationMs: clip.durationMs, mediaPath: clip.mediaPath,
          audioLanguage: clip.languages.length === 1 ? clip.languages[0]! : 'mul',
          subtitleLanguages: [], listingVisibility: 'hidden' });
        cursor += clip.durationMs;
        sequence += 1;
        previousClip = clip.id;
      }
    }
  }
  return result;
}

export function reconcilePlayoutPlans(db: LkpDatabase, config: AppConfig, earliestMs = Date.now() + 60_000, refreshBumpers = false): number {
  if (config.station?.enabled) throw new Error('Profile schedules must be regenerated with fixed handover barriers');
  const bounds = db.scheduleBounds();
  if (!bounds) return 0;
  const entries = db.listSchedule(earliestMs, bounds.lastMs + 1).filter((entry) => entry.startsAtMs >= earliestMs);
  if (!entries.length) return 0;
  const mediaById = new Map(db.listMedia(false).map((media) => [media.id, media]));
  const planning: SchedulePlanning = schedulePlanning(db, config);
  const before = db.listSchedule(bounds.firstMs, entries[0]!.startsAtMs);
  let programmeOrdinal = before.filter(isProgramme).length;
  let cursor = entries[0]!.startsAtMs;
  let changed = 0;
  const planned = entries.map((entry) => {
    let plan = entry.playoutPlan;
    if (plan && refreshBumpers) {
      const segments = plan.segments.map((part) => {
        if (part.type !== 'ad-ident') return part;
        const bumper = planning.bumpers.find((candidate) => candidate.character === part.character);
        return bumper ? { ...part, mediaPath: bumper.mediaPath, durationMs: bumper.durationMs } : part;
      });
      if (segments.some((part, i) => part !== plan!.segments[i] && JSON.stringify(part) !== JSON.stringify(plan!.segments[i]))) {
        plan = { ...plan, segments, durationMs: segments.reduce((sum, part) => sum + part.durationMs, 0) };
        changed += 1;
      }
    }
    if (isProgramme(entry)) {
      const media = mediaById.get(entry.mediaId);
      if (media && (!plan || (refreshBumpers && !plan.segments.some(part => part.type === 'ad')))) {
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
  childrenSettings(db,config);
  if (options.force) db.clearSchedule();
  const now = Date.now();
  const existing = db.scheduleBounds();
  const zone = config.channel.timezone;
  const requestedStart = options.fromMs ?? DateTime.fromMillis(now, { zone }).startOf('day').toMillis();
  const horizonDays = options.horizonDays ?? config.schedule.horizonDays;
  const targetEnd = DateTime.fromMillis(Math.max(now, requestedStart), { zone }).plus({ days: horizonDays }).endOf('day').toMillis();
  if (existing && existing.lastMs >= targetEnd) {
    const added=config.children?.enabled ? 0 : reconcileIntermissions(db,config);
    const bounds=db.scheduleBounds()!;
    return {added,firstMs:bounds.firstMs,lastMs:bounds.lastMs};
  }
  const previous = existing ? db.listSchedule(existing.firstMs, existing.lastMs + 1) : [];
  const last = previous.at(-1);
  const startMs = last?.endsAtMs ?? requestedStart;
  const sequence = last ? last.sequence + 1 : 0;
  const planning: SchedulePlanning = schedulePlanning(db, config);
  const entries = buildScheduleEntries(db.listMedia(), config.schedule.seed, startMs, targetEnd, sequence, previous, planning);
  db.insertSchedule(entries);
  const intermissions = config.children?.enabled ? 0 : reconcileIntermissions(db, config);
  const bounds = db.scheduleBounds()!;
  return { added: entries.length + intermissions, firstMs: bounds.firstMs, lastMs: bounds.lastMs };
}

export function rebuildFutureSchedule(
  db: LkpDatabase, config: AppConfig, earliestMs = Date.now() + 2 * 60_000,
): { removed: number; added: number; startMs: number; lastMs: number } {
  const bounds = db.scheduleBounds();
  if (!bounds) throw new Error('No schedule to rebuild');
  let boundary = db.nextAfter(earliestMs);
  while (boundary && !isProgramme(boundary)) boundary = db.nextAfter(boundary.endsAtMs);
  if (!boundary) throw new Error('No safe future programme boundary');
  const prefix = db.listSchedule(bounds.firstMs, boundary.startsAtMs);
  const future = db.listSchedule(boundary.startsAtMs, bounds.lastMs + 1);
  if (!config.station?.enabled && future.some((entry) => entry.showId === 'lkp-weather')) {
    throw new Error('Future weather programmes are published; move them before rebuilding the schedule');
  }
  const planning: SchedulePlanning = schedulePlanning(db, config);
  planning.reserved = future.filter(e => e.showId === 'lkp-weather');
  const generated = buildScheduleEntries(db.listMedia(), config.schedule.seed,
    boundary.startsAtMs, bounds.lastMs, boundary.sequence, prefix, planning);
  const errors = validateTimeline([...prefix.slice(-1), ...generated]);
  if (errors.length) throw new Error(`Rebuilt timeline is invalid: ${errors.slice(0, 3).join('; ')}`);
  db.db.transaction(() => {
    const current = db.nextAfter(boundary.startsAtMs);
    if (current?.id !== boundary.id || current.startsAtMs !== boundary.startsAtMs) {
      throw new Error('Schedule changed during rebuild');
    }
    db.db.prepare('DELETE FROM schedule_entries WHERE sequence >= ?').run(boundary.sequence);
    db.insertSchedule(generated);
  }).immediate();
  return { removed: future.length, added: generated.length,
    startMs: boundary.startsAtMs, lastMs: generated.at(-1)!.endsAtMs };
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

/** Replace daytime only; all Nacht entries retain identities, times and plans. */
export function setChildrenAge(db: LkpDatabase, config: AppConfig, age: number, tolerance?: number,
  earliestMs = Date.now()+120_000): { startMs: number; replaced: number; added: number } {
  validateAge(age,tolerance ?? config.children?.ageToleranceYears ?? 1);
  if (!config.children?.enabled || !config.station?.enabled) throw new Error('Age regeneration requires the children clock and station profile barriers');
  childrenSettings(db,config);
  tolerance ??= config.children!.ageToleranceYears;
  const bounds=db.scheduleBounds();
  if (!bounds) {
    saveChildrenAge(db,age,tolerance,earliestMs);
    config.children={...config.children,targetAgeYears:age,ageToleranceYears:tolerance,effectiveAtMs:earliestMs};
    return {startMs:earliestMs,replaced:0,added:0};
  }
  const old=db.listSchedule(bounds.firstMs,bounds.lastMs+1);
  const first=old.find(e=>e.startsAtMs>=earliestMs && e.presentation?.profile==='lkp' && e.presentation.kind==='programme' && e.showId!=='lkp-weather');
  if (!first) throw new Error('No safe future children programme boundary');
  const nextConfig={...config,children:{...config.children,targetAgeYears:age,ageToleranceYears:tolerance,effectiveAtMs:first.startsAtMs}};
  const prefix=old.filter(e=>e.sequence<first.sequence), tail=old.filter(e=>e.sequence>=first.sequence);
  const preserved=(e:ScheduleEntry)=>e.presentation?.profile==='ln' || e.showId==='lkp-weather' || e.presentation?.kind==='handover';
  const generated:ScheduleEntry[]=[];
  let index=0,sequence=first.sequence;
  while(index<tail.length) {
    const e=tail[index]!;
    if(preserved(e)) { generated.push({...e,sequence:sequence++}); index++; continue; }
    const start=e.startsAtMs;
    let end=e.endsAtMs;
    while(index<tail.length && !preserved(tail[index]!)) {end=tail[index]!.endsAtMs;index++;}
    const entries=buildChildrenSchedule(db.listMedia(),config.schedule.seed,start,end,sequence,[...prefix,...generated].filter(e=>e.presentation?.profile!=='ln'),nextConfig,{ads:db.listAds(),clips:readRotationLibrary(config),bumpers:readBumpers(config)});
    generated.push(...entries);sequence+=entries.length;
  }
  const errors=validateTimeline([...prefix.slice(-1),...generated]);
  if(errors.length) throw new Error(`Invalid age regeneration: ${errors[0]}`);
  preserveEpgIdentities(generated,tail.filter(preserved),prefix);
  db.db.transaction(()=>{
    const current=db.nextAfter(first.startsAtMs);
    if(current?.id!==first.id || JSON.stringify(db.listSchedule(first.startsAtMs,bounds.lastMs+1))!==JSON.stringify(tail)) throw new Error('Schedule changed during age regeneration');
    db.db.prepare('DELETE FROM schedule_entries WHERE sequence>=?').run(first.sequence);
    db.insertSchedule(generated);
    saveChildrenAge(db,age,tolerance,first.startsAtMs);
  }).immediate();
  config.children=nextConfig.children;
  return {startMs:first.startsAtMs,replaced:tail.filter(e=>!preserved(e)).length,added:generated.length};
}

/** Allocate new IDs around all retained events, including events inserted later in the transaction. */
export function preserveEpgIdentities(entries:ScheduleEntry[],retained:ScheduleEntry[],prefix:ScheduleEntry[]=[]):void {
  const immutable=new Set(retained.map(e=>e.id)), occupied=new Map<number,number[]>();
  const occupy=(e:ScheduleEntry)=>{
    if(e.epgEventId===undefined) return;
    const dates=occupied.get(e.epgEventId) ?? [];dates.push(e.startsAtMs);occupied.set(e.epgEventId,dates);
  };
  [...prefix,...retained].forEach(occupy);
  for(const e of entries) {
    if(immutable.has(e.id)) continue;
    let candidate=(e.sequence%65535)+1, attempts=0;
    while(occupied.get(candidate)?.some(at=>Math.abs(at-e.startsAtMs)<=32*86_400_000)) {
      candidate=candidate%65535+1;
      if(++attempts>=65535) throw new Error('DVB event namespace exhausted');
    }
    e.epgEventId=candidate;occupy(e);
  }
}
