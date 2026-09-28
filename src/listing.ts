import type { ScheduleEntry } from './types.js';

export function isPublicScheduleEntry(entry: ScheduleEntry): boolean {
  if (entry.showId === 'lkp-weather') return true;
  if (entry.listingVisibility === 'hidden') return false;
  return !entry.showId.startsWith('lkp-');
}

// Internal continuity items remain in the authoritative schedule, but public
// listings extend the preceding programme across them instead of exposing a
// fake EPG/XLSX programme or leaving a hole in the timeline.
export function publicSchedule(entries: ScheduleEntry[]): ScheduleEntry[] {
  const visible: ScheduleEntry[] = [];
  for (const entry of entries) {
    if (isPublicScheduleEntry(entry)) {
      visible.push({ ...entry });
      continue;
    }
    const previous = visible.at(-1);
    if (previous && previous.endsAtMs === entry.startsAtMs) {
      previous.endsAtMs = entry.endsAtMs;
      previous.durationMs = previous.endsAtMs - previous.startsAtMs;
    }
  }
  return visible;
}
