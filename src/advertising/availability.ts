import { DateTime } from 'luxon';

/** Seasonal spots run only within their annual Prague civil-date windows. */
export function adAvailableAt(ad: { tags?: readonly string[]; durationMs: number }, atMs: number): boolean {
  const tags = ad.tags ?? [];
  const seasonal = tags.filter((tag) => tag === 'christmas' || tag === 'summer');
  if (seasonal.length === 0) return true;
  if (!Number.isSafeInteger(atMs) || !Number.isSafeInteger(ad.durationMs) || ad.durationMs <= 0) return false;
  const local = DateTime.fromMillis(atMs, { zone: 'Europe/Prague' });
  if (!local.isValid) return false;
  return seasonal.every((tag) => {
    if (tag === 'christmas') {
      if (local.month !== 12 || local.day > 25) return false;
      return atMs + ad.durationMs <= local.startOf('day').set({ day: 26 }).toMillis();
    }
    if (local.month < 6 || local.month > 8) return false;
    return atMs + ad.durationMs <= local.startOf('day').set({ month: 9, day: 1 }).toMillis();
  });
}
