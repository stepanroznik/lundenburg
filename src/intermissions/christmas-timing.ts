import type { Film } from './model.js';

// Contacts follow the locked, cached performances (word alignment reviewed).
// Keep Foley and the illustrated action on the same timeline.
export const parcelStarts = [1, 3.4, 5.8, 8.2] as const;
export function christmasMapBeats(film: Film) {
  const cue = (i: number) => (film.cues[i]?.from ?? 0) / film.fps;
  return { taps: [1.65, 2.35, 3.05].map(t => cue(13) + t),
    treats: cue(13) + 4.96, starTurns: cue(22) + 5.7 };
}
