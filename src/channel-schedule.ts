import crypto from 'node:crypto';
import fs from 'node:fs';
import type { AppConfig, MediaItem, ScheduleEntry } from './types.js';
import { eligibleFor, mediaPolicy, profileWindow } from './channels.js';
import { programmeOrder } from './acquisition/programming.js';
import { stableId } from './util.js';
import { DateTime } from 'luxon';

export interface PresentationAsset { id: string; path: string; durationMs: number; fullScreen: boolean; destination: string }
export function stationAssets(config: AppConfig): Map<string, PresentationAsset> {
  const file = config.station?.assetManifest;
  if (!file || !fs.existsSync(file)) throw new Error('LN presentation assets have not been activated');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.version !== 1 || manifest.status !== 'ready' || manifest.fps !== config.video.fps || !Array.isArray(manifest.assets)) throw new Error('Invalid station presentation manifest');
  const assets = new Map<string, PresentationAsset>();
  for (const a of manifest.assets as PresentationAsset[]) {
    if (assets.has(a.id) || !Number.isSafeInteger(a.durationMs) || a.durationMs <= 0 || !a.fullScreen || !fs.existsSync(a.path)) throw new Error('Missing or invalid station presentation asset');
    assets.set(a.id, a);
  }
  for (const id of ['evening', 'morning', 'ident', 'outro', 'continuity', 'day-continuity']) if (!assets.has(id)) throw new Error(`Missing station asset: ${id}`);
  return assets;
}

export interface RotationRecord { mediaId: string; count: number; lastAtMs: number }
export interface ProfilePlanning {
  config: AppConfig; history?: RotationRecord[]; reserved?: ScheduleEntry[];
}
export type DayPlanner = (startMs: number, endMs: number, sequence: number, previous: ScheduleEntry[]) => ScheduleEntry[];
const blockFor = (category: string) => ({ news: 'aktuell', science: 'neugierig', education: 'neugierig', regional: 'heimat', calm: 'nachtruhe',
  history: 'geschichte', society: 'geschichte', comedy: 'internet', sitcom: 'feierabend', movie: 'kino', family: 'kino' }[category] ?? 'neugierig');
const genreFor = (category: string) => ({ news: 0x20, science: 0x90, education: 0x90, regional: 0x80, calm: 0x91,
  history: 0x92, society: 0x80, comedy: 0x14, sitcom: 0x14, movie: 0x10, family: 0x10 }[category] ?? 0x90);
const shuffle = (seed: string, id: string) => crypto.createHash('sha256').update(`${seed}:${id}`).digest('hex');

/** The one station timeline is partitioned at civil-time profile barriers. */
export function buildProfileSchedule(catalogue: MediaItem[], seed: string, startMs: number, targetEndMs: number,
  initialSequence: number, previousEntries: ScheduleEntry[], planning: ProfilePlanning, dayPlanner: DayPlanner): ScheduleEntry[] {
  const { config } = planning, station = config.station!;
  const assets = stationAssets(config), result: ScheduleEntry[] = [];
  let cursor = startMs, sequence = initialSequence;
  const count = new Map<string, number>(), last = new Map<string, number>();
  for (const r of planning.history ?? []) { count.set(r.mediaId, r.count); last.set(r.mediaId, r.lastAtMs); }
  const now = Date.now();
  for (const e of previousEntries) if ((!planning.history || e.startsAtMs >= now) && e.presentation?.kind === 'programme' && e.presentation.profile === 'ln') {
    count.set(e.mediaId, (count.get(e.mediaId) ?? 0) + 1); last.set(e.mediaId, e.startsAtMs);
  }
  const push = (e: ScheduleEntry) => { result.push(e); cursor = e.endsAtMs; sequence = e.sequence + 1; };
  const continuity = (id: string, profile: 'lkp' | 'ln', kind: 'handover' | 'ident' | 'intro' | 'outro' | 'gap', durationMs?: number, block?: string) => {
    const asset = assets.get(id) ?? assets.get('ident')!;
    const duration = durationMs ?? asset.durationMs;
    push({ id: stableId(seed, sequence, id, cursor), sequence, mediaId: `station-${id}`, showId: `station-${profile}`,
      showTitle: station.profiles[profile].name, episodeTitle: kind === 'gap' ? profile === 'ln' ? 'Nachtbilder' : 'Eine kleine Pause' : profile === 'ln' ? 'Lundenburg Nacht' : 'Guten Morgen, Lundenburg!',
      description: kind === 'handover' ? `Programmbeginn ${station.profiles[profile].name}.` : 'Eine kleine Pause im Programm.',
      startsAtMs: cursor, endsAtMs: cursor + duration, durationMs: duration, mediaPath: asset.path,
      subtitleLanguages: [], audioLanguage: 'zxx', listingVisibility: kind === 'handover' || kind === 'gap' ? 'public' : 'hidden',
      presentation: { profile, kind, ...(block ? { block } : {}), ...(kind === 'gap' ? { loop: true } : {}) } });
  };
  const reserved = [...(planning.reserved ?? [])].filter(e => e.startsAtMs >= startMs).sort((a, b) => a.startsAtMs - b.startsAtMs);
  let previousShow = previousEntries.at(-1)?.showId;
  while (cursor < targetEndMs) {
    const window = profileWindow(cursor, station), windowEnd = window.endsAtMs;
    if (cursor === window.startsAtMs) continuity(window.profile === 'ln' ? 'evening' : 'morning', window.profile, 'handover');
    if (window.profile === 'lkp') {
      const special = reserved.find(e => e.startsAtMs >= cursor && e.startsAtMs < windowEnd);
      const end = Math.min(special?.startsAtMs ?? windowEnd, targetEndMs);
      const previous = [...previousEntries, ...result].filter(e => !e.presentation || e.presentation.profile === 'lkp');
      const entries = dayPlanner(cursor, end, sequence, previous);
      for (const e of entries) push({ ...e, presentation: { profile: 'lkp', kind: e.listingVisibility === 'hidden' ? 'ident' : 'programme' } });
      if (cursor < end) continuity('day-continuity', 'lkp', 'gap', end - cursor);
      if (special && cursor === special.startsAtMs && cursor < targetEndMs) {
        if (special.endsAtMs > windowEnd) throw new Error('Published weather would cross a channel boundary');
        push({ ...special, sequence, presentation: { profile: 'lkp', kind: 'programme' } });
      }
      continue;
    }
    const newsAt = window.startsAtMs + station.newsOffsetMinutes * 60_000;
    const newsScheduled = [...previousEntries, ...result].some(e => e.presentation?.block === 'aktuell' && e.startsAtMs >= window.startsAtMs && e.startsAtMs < windowEnd);
    const news = catalogue.filter(m => eligibleFor(m, 'ln', station, cursor) && mediaPolicy(m, station).retention === 'latest-only')
      .sort((a, b) => publication(b) - publication(a) || a.id.localeCompare(b.id))[0];
    // If a restart or guarded rebuild happens after the preferred first block,
    // still carry one latest bulletin in this overnight window. A committed
    // bulletin above prevents a duplicate when the future tail is regenerated.
    const newsDue = !newsScheduled && cursor >= newsAt && cursor < windowEnd;
    const beforeNews = !newsScheduled && cursor < newsAt;
    const quiet = DateTime.fromMillis(cursor, { zone: station.timezone }).hour >= 2 && DateTime.fromMillis(cursor, { zone: station.timezone }).hour < 6;
    const cutoff = beforeNews ? Math.min(newsAt, windowEnd) : windowEnd;
    const budget = cutoff - cursor;
    const bumperMs = (assets.get('intro-neugierig')?.durationMs ?? 0) + assets.get('outro')!.durationMs;
    const eligible = catalogue.filter(m => {
      if (!eligibleFor(m, 'ln', station, cursor) || m.durationMs + bumperMs > budget || !Number.isSafeInteger(m.durationMs) || m.durationMs <= 0) return false;
      const p = mediaPolicy(m, station);
      if (!station.profiles.ln.languages.includes(m.audioLanguage ?? m.defaultLanguage ?? 'unknown') || !station.profiles.ln.categories.includes(p.category)) return false;
      if (p.retention === 'latest-only') return newsDue && m.id === news?.id;
      if (quiet && (p.intensity !== 'calm' || p.timeOfNight === 'evening')) return false;
      if (p.timeOfNight === 'quiet' && !quiet) return false;
      // A multipart sequence cannot jump over an earlier unplayed part to fill a gap.
      if (p.seriesId && p.seriesOrder !== undefined && catalogue.some(other => {
        const op = mediaPolicy(other, station);
        return other.enabled && op.seriesId === p.seriesId && op.seriesOrder !== undefined && op.seriesOrder < p.seriesOrder! &&
          (count.get(other.id) ?? 0) <= (count.get(m.id) ?? 0);
      })) return false;
      return true;
    });
    const hour = DateTime.fromMillis(cursor, { zone: station.timezone }).hour;
    const preference = quiet ? ['calm', 'regional', 'movie', 'education'] : hour >= 23 || hour < 2
      ? ['history', 'society', 'regional', 'science', 'comedy', 'education', 'movie', 'family']
      : ['science', 'education', 'comedy', 'regional', 'history', 'society', 'movie', 'family'];
    eligible.sort((a, b) => {
      const pa = mediaPolicy(a, station), pb = mediaPolicy(b, station);
      if (newsDue && (a.id === news?.id || b.id === news?.id)) return a.id === news?.id ? -1 : 1;
      const ca = count.get(a.id) ?? 0, cb = count.get(b.id) ?? 0;
      return (a.showId === previousShow ? 1 : 0) - (b.showId === previousShow ? 1 : 0) ||
        ca - cb || preference.indexOf(pa.category) - preference.indexOf(pb.category) ||
        (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0) ||
        (a.showId === b.showId && station.rotation === 'sequential' ? programmeOrder(a, b) : shuffle(seed, a.id).localeCompare(shuffle(seed, b.id)));
    });
    // Fair collection rotation is stricter than generic programme diversity.
    const selected = eligible.find(m => {
      if (mediaPolicy(m, station).retention !== 'protected') return true;
      const collection = catalogue.filter(o => o.showId === m.showId && eligibleFor(o, 'ln', station, cursor));
      return (count.get(m.id) ?? 0) <= Math.min(...collection.map(o => count.get(o.id) ?? 0));
    });
    if (!selected) { continuity('continuity', 'ln', 'gap', budget); continue; }
    const policy = mediaPolicy(selected, station), block = blockFor(policy.category);
    const intro = assets.get(`intro-${block}`);
    if (intro) continuity(intro.id, 'ln', 'intro', undefined, block);
    const publicationDate = publication(selected) ? DateTime.fromMillis(publication(selected), { zone: station.timezone }).toISODate()! : undefined;
    const description = policy.retention === 'latest-only' && publicationDate
      ? `${selected.description} Originalveröffentlichung: ${publicationDate}.` : selected.description;
    push({ id: stableId(seed, sequence, selected.id, cursor), sequence, mediaId: selected.id, showId: selected.showId,
      showTitle: block === 'aktuell' ? 'Lundenburg Aktuell' : selected.showTitle, episodeTitle: selected.episodeTitle, description,
      ...(selected.season !== undefined ? { season: selected.season } : {}), ...(selected.episode !== undefined ? { episode: selected.episode } : {}),
      startsAtMs: cursor, endsAtMs: cursor + selected.durationMs, durationMs: selected.durationMs, mediaPath: selected.mediaPath,
      ...(selected.audioLanguage ? { audioLanguage: selected.audioLanguage } : {}), subtitleLanguages: [...new Set(selected.subtitles.map(s => s.language))],
      listingVisibility: 'public', presentation: { profile: 'ln', kind: 'programme', block, genre: genreFor(policy.category), ...(publicationDate ? { publicationDate } : {}) } });
    count.set(selected.id, (count.get(selected.id) ?? 0) + 1); last.set(selected.id, cursor); previousShow = selected.showId;
    continuity('outro', 'ln', 'outro', undefined, block);
  }
  return result;
}
function publication(m: MediaItem): number { return Number((m.technical.acquisition as { publishedAt?: number } | undefined)?.publishedAt ?? 0); }
