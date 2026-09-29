import type { Presenter, Language } from '../characters/types.js';
import type { Film } from '../intermissions/model.js';
import type { SpeechAsset } from '../weather/model.js';

export const bumperFps = 30;
export const bumperFrames = 150;
export const speechFrom = 44;
export const bumperDefinitions: Array<{ presenter: Presenter; language: Language; text: string }> = [
  { presenter: 'knurpsi', language: 'de', text: 'Werbung' },
  { presenter: 'sisi', language: 'de', text: 'Werbung' },
  { presenter: 'schalinka', language: 'cs', text: 'Reklama' },
  { presenter: 'haluschka', language: 'sk', text: 'Reklama' },
];
export function bumperFilm(definition: typeof bumperDefinitions[number], asset: SpeechAsset): Film {
  if (!asset.audio || !asset.cues.some(c => c.value !== 'rest') || speechFrom / bumperFps + asset.duration > 3.3) {
    throw new Error(`Bumper speech missing, unaligned, or too long: ${definition.presenter}`);
  }
  const id = `ad-bumper-${definition.presenter}`;
  return {
    skit: { id, title: 'WERBUNG', scene: 'ident', kind: 'voiced', cast: [definition.presenter],
      synopsis: 'A visible LKP presenter announces the ad break with a prop and aligned speech.',
      lines: [{ speaker: definition.presenter, language: definition.language, text: definition.text }] },
    fps: bumperFps, durationInFrames: bumperFrames, logoFrom: 100,
    cues: [{ speaker: definition.presenter, language: definition.language, text: definition.text,
      from: speechFrom, frames: Math.ceil(asset.duration * bumperFps), asset }],
    sfx: `advertising/effects/${id}.wav`, preview: false,
  };
}
export function spokenEndFrame(film: Film): number {
  const cue = film.cues[0]!;
  return cue.from + Math.ceil(Math.max(...cue.asset.cues.filter(c => c.value !== 'rest').map(c => c.end)) * film.fps);
}
