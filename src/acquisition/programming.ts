import { DateTime } from 'luxon';
import type { MediaItem } from '../types.js';
import { acquiredRank, type Classification } from './classification.js';
import { recycledContent } from './recycled.js';
import { catalogueMetadata, isCatalogueMovie } from '../catalogue.js';

export function editorialMetadata(item: MediaItem): { classification?: Classification; publishedAt?: number } {
  return (item.technical.acquisition ?? {}) as { classification?: Classification; publishedAt?: number };
}
export function ordinaryProgramme(item: MediaItem, filmThreshold: number): boolean {
  if (isCatalogueMovie(item)) return false;
  if (catalogueMetadata(item)?.kind === 'series') return true;
  return Boolean(editorialMetadata(item).classification) || item.durationMs < filmThreshold;
}
export function programmeOrder(a: MediaItem, b: MediaItem): number {
  return (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) ||
    (editorialMetadata(a).publishedAt ?? 0) - (editorialMetadata(b).publishedAt ?? 0) || a.id.localeCompare(b.id);
}
export function programmeEligible(item: MediaItem, at: number, zone: string): boolean {
  const classification = editorialMetadata(item).classification;
  if (!classification) return true;
  if (recycledContent({ classification })) return false;
  if (!acquiredRank(classification.rank)) return false;
  if (!classification.seasonalTags.length) return true;
  const date = DateTime.fromMillis(at, { zone });
  const season = date.month >= 3 && date.month <= 5 ? 'spring' : date.month >= 6 && date.month <= 8 ? 'summer'
    : date.month >= 9 && date.month <= 11 ? 'autumn' : 'winter';
  return classification.seasonalTags.every(tag => tag === 'christmas' ? date.month === 12 || (date.month === 1 && date.day <= 6)
    : tag === 'easter' ? date.month === 3 || date.month === 4 : tag === 'halloween' ? date.month === 10 : tag === season);
}
/** Seasonal episodes get extra rotation weight in their period; media stays in the library all year. */
export function programmeRotation(items: MediaItem[], at: number, zone: string): MediaItem[] {
  const eligible = items.filter(item => programmeEligible(item, at, zone));
  return [...eligible, ...eligible.filter(item => editorialMetadata(item).classification?.seasonalTags.length)];
}
