import type { MediaItem } from './types.js';

// Cataloguing is deterministic. Translation belongs to optional acquisition
// enrichment; identities, numbering and meaningful titles stay authoritative.
export interface CatalogueText {
  showTitle: string;
  episodeTitle: string;
  description: string;
  season?: number;
  episode?: number;
}

export function cleanCatalogueText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function normalizeCatalogueText<T extends CatalogueText>(item: T, aliases: string[] = []): T {
  const showTitle = cleanCatalogueText(item.showTitle);
  let title = cleanCatalogueText(item.episodeTitle);
  // Strip an exact programme prefix/suffix, only at a separator boundary.
  // A character name inside a real episode title remains untouched.
  for (const name of [showTitle, ...aliases].map(cleanCatalogueText).filter(Boolean)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(new RegExp(`^${escaped}\\s*[:|–—-]\\s*`, 'iu'), '')
      .replace(new RegExp(`\\s*\\|\\s*${escaped}(?:\\s*\\|\\s*\\d{2}\\.\\d{2}\\.\\d{4})?$`, 'iu'), '');
  }
  // Upload labels are not episode names. Keep unknown suffixes and dates.
  title = title.replace(/\s*[-|–—]\s*(?:full(?: hd)? episode|full hd|hd|official video)\s*$/iu, '').trim();
  if (!title || /^(?:Staffel \d+[, ·]* )?(?:Folge|Episode) \d+$/iu.test(title)) {
    if (item.episode !== undefined) {
      title = item.season === undefined ? `Folge ${item.episode}` : `Staffel ${item.season} · Folge ${item.episode}`;
    }
  }
  return { ...item, showTitle, episodeTitle: title || showTitle, description: cleanCatalogueText(item.description) };
}

export interface CatalogueMetadata {
  version: 1;
  kind: 'series' | 'movie';
  episodeNumberSource?: 'source' | 'local';
  originalTitle: string;
}

export function catalogueMetadata(item: MediaItem): CatalogueMetadata | undefined {
  return item.technical.catalogue as CatalogueMetadata | undefined;
}

export function isCatalogueMovie(item: MediaItem): boolean {
  return catalogueMetadata(item)?.kind === 'movie' ||
    // Known legacy films predate the explicit show.yaml kind field.
    ['the-man-from-earth', 'wreck-it-ralph'].includes(item.showId);
}

export function sourceEpisodeNumbers(item: MediaItem): { season?: number; episode?: number } {
  if (isCatalogueMovie(item) || catalogueMetadata(item)?.episodeNumberSource === 'local') return {};
  return { ...(item.season !== undefined ? { season: item.season } : {}), ...(item.episode !== undefined ? { episode: item.episode } : {}) };
}

function explicitSourceNumbers(item: MediaItem): MediaItem {
  if (isCatalogueMovie(item) || item.showId.startsWith('lkp-') || item.episode !== undefined) return item;
  const match = /\bS(\d{1,3})E(\d{1,4})\b/iu.exec(item.episodeTitle) ??
    /\b(?:season|series|staffel)\s+(\d{1,3})\s*[,·/-]?\s*(?:episode|folge)\s+(\d{1,4})\b/iu.exec(item.episodeTitle);
  if (!match || Number(match[2]) <= 0) return item;
  return { ...item, season: item.season ?? Number(match[1]), episode: Number(match[2]) };
}

// Allocate local numbers once, then carry them across scans by asset identity.
// Do not derive numbers from download order on every scan or invent a season.
export function normalizeCatalogue(items: MediaItem[], existing: MediaItem[] = []): MediaItem[] {
  items = items.map(explicitSourceNumbers);
  const prior = new Map(existing.map(item => [item.id, item]));
  const next = new Map<string, number>();
  for (const item of [...existing, ...items]) {
    if (!isCatalogueMovie(item) && Number.isSafeInteger(item.episode) && item.episode! > 0) {
      next.set(item.showId, Math.max(next.get(item.showId) ?? 0, item.episode!));
    }
  }
  const result = new Map<string, MediaItem>();
  for (const original of [...items].sort((a, b) => a.showId.localeCompare(b.showId) || a.id.localeCompare(b.id))) {
    if (original.showId.startsWith('lkp-')) { result.set(original.id, original); continue; }
    let item = normalizeCatalogueText(original);
    const metadata: CatalogueMetadata = {
      version: 1, kind: isCatalogueMovie(item) ? 'movie' : 'series',
      originalTitle: catalogueMetadata(item)?.originalTitle ?? original.episodeTitle,
    };
    if (metadata.kind === 'movie') {
      delete item.season;
      delete item.episode;
      if (/^Staffel \d+.*Folge \d+$|^Folge \d+$/iu.test(item.episodeTitle)) item.episodeTitle = item.showTitle;
    } else {
      const old = prior.get(item.id);
      const local = catalogueMetadata(old ?? item)?.episodeNumberSource === 'local';
      if (item.episode === undefined && old?.episode !== undefined && local) {
        item.episode = old.episode;
        metadata.episodeNumberSource = 'local';
      } else if (item.episode === undefined) {
        item.episode = (next.get(item.showId) ?? 0) + 1;
        next.set(item.showId, item.episode);
        metadata.episodeNumberSource = 'local';
      } else {
        if (!Number.isSafeInteger(item.episode) || item.episode <= 0) throw new Error(`Invalid episode number: ${item.id}`);
        metadata.episodeNumberSource = catalogueMetadata(item)?.episodeNumberSource ?? 'source';
      }
      if (item.season !== undefined && (!Number.isSafeInteger(item.season) || item.season < 0)) throw new Error(`Invalid season number: ${item.id}`);
    }
    item.technical = { ...item.technical, catalogue: metadata };
    result.set(item.id, normalizeCatalogueText(item));
  }
  return items.map(item => result.get(item.id)!);
}

export function episodeNumberLabel(item: { season?: number; episode?: number }): string {
  return item.episode === undefined ? '' : item.season === undefined
    ? `Folge ${item.episode}` : `Staffel ${item.season} · Folge ${item.episode}`;
}
