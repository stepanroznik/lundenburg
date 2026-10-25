import { DateTime } from 'luxon';

/** Christmas spots run annually on December 1–25, wholly within Prague civil dates. */
export function adAvailableAt(ad: { tags?: readonly string[]; durationMs: number }, atMs: number): boolean {
  if (!ad.tags?.includes('christmas')) return true;
  if (!Number.isSafeInteger(atMs) || !Number.isSafeInteger(ad.durationMs) || ad.durationMs <= 0) return false;
  const local = DateTime.fromMillis(atMs, { zone: 'Europe/Prague' });
  if (!local.isValid || local.month !== 12 || local.day > 25) return false;
  const end = local.startOf('day').set({ day: 26 }).toMillis();
  return atMs + ad.durationMs <= end;
}
