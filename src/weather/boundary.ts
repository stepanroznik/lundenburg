import type { LkpDatabase } from '../database.js';
import type { AppConfig, ScheduleEntry } from '../types.js';
import { profileWindow } from '../channels.js';

/** Both automatic generation and publication select the same reserved window. */
export function weatherBoundary(db: LkpDatabase, config: AppConfig, earliestMs: number, untilMs: number, durationMs = 1): ScheduleEntry | undefined {
  if (!config.station?.enabled) return db.nextAfter(earliestMs);
  const rows = db.listSchedule(earliestMs, untilMs);
  const remaining = new Map<string, number>();
  let groupEnd = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.presentation?.block !== 'weather') { groupEnd = 0; continue; }
    groupEnd ||= row.endsAtMs;
    remaining.set(row.id, groupEnd - row.startsAtMs);
  }
  return rows.find(row => {
    const window = profileWindow(row.startsAtMs, config.station!);
    return row.startsAtMs >= earliestMs && window.profile === 'lkp' &&
      row.startsAtMs + durationMs <= Math.min(window.endsAtMs, untilMs) &&
      (!config.children?.enabled || (remaining.get(row.id) ?? 0) >= durationMs);
  });
}
