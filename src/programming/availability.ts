import { DateTime } from 'luxon';
export type AnnualAvailability = 'christmas' | 'summer';
/** Whole-asset annual availability, always on the Prague civil calendar. */
export function availableDuring(rule: AnnualAvailability | undefined, atMs: number, durationMs = 1): boolean {
  if (!rule) return true;
  if (!Number.isSafeInteger(atMs) || !Number.isSafeInteger(durationMs) || durationMs <= 0) return false;
  const local = DateTime.fromMillis(atMs, { zone: 'Europe/Prague' });
  if (!local.isValid) return false;
  if (rule === 'christmas') return local.month === 12 && local.day <= 25 && atMs + durationMs <= local.startOf('day').set({ day: 26 }).toMillis();
  return local.month >= 6 && local.month <= 8 && atMs + durationMs <= local.startOf('day').set({ month: 9, day: 1 }).toMillis();
}
