import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeEffectTrack, type Effect } from '../intermissions/audio.js';
import { brandFilms, type BrandFilm } from './identity.js';

/** Original D–A–E signature, spacious at night and lifted an octave at dawn. */
export function signatureEffects(film: BrandFilm): Effect[] {
  if (film === 'continuity' || film === 'day-continuity') return []; // Quiet loops without a repeated ident chime.
  const morning = film === 'morning', short = film === 'intro' || film === 'outro';
  const landing = short ? .4 : film === 'ident' ? 1.5 : morning ? 5.9 : 5.5;
  const notes = morning ? [587.33, 880, 1174.66] : [293.665, 440, 659.255];
  const effects: Effect[] = [];
  if (!short) {
    effects.push({ at: .5, duration: film === 'ident' ? 2.6 : 5, frequency: 90, level: .012, texture: 'wind' });
    if (film === 'evening') for (let i = 0; i < 5; i++) effects.push({ at: 1.4 + i * .23,
      duration: .9, frequency: 880 - i * 95, level: .014, bend: -.15 });
  }
  notes.forEach((frequency, i) => {
    effects.push({ at: landing + i * .42, duration: short ? 1.5 : 2.2, frequency, level: .055, bend: 0 });
    effects.push({ at: landing + i * .42, duration: 1.1, frequency: frequency * 2.005, level: .010, bend: 0 });
    effects.push({ at: landing + i * .42 + .19, duration: 1.5, frequency, level: .010, bend: 0 });
  });
  return effects;
}

export function createSignature(film: BrandFilm, directory: string): string {
  const raw = path.join(directory, `${film}-dry.wav`), output = path.join(directory, `${film}.wav`);
  writeEffectTrack(`ln-${film}`, brandFilms[film].seconds, raw, signatureEffects(film));
  // Soft room reflections; finite silence at both ends prevents boundary clicks.
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', raw, '-af',
    'aecho=0.8:0.65:121|237:0.16|0.09,highpass=f=65,lowpass=f=8500,alimiter=limit=0.71:level=false:latency=true,afade=t=in:d=0.05,afade=t=out:st=' +
    (brandFilms[film].seconds - .5) + ':d=0.5', '-t', String(brandFilms[film].seconds), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output], { stdio: 'pipe', timeout: 30_000 });
  return output;
}
