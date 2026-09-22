import type { Language, Presenter } from '../characters/types.js';
import type { SpeechAsset } from '../weather/model.js';
import type { SpeechDirection } from '../weather/speech.js';

import { seasonAt, type Season } from './season.js';
export { seasonAt } from './season.js';
export type { Season } from './season.js';
export type Scene = 'ident' | 'soap' | 'dam' | 'vienna' | 'dragon' | 'biscuits' | 'quiet' | 'snowballs' | 'snowman' | 'puddles' | 'flowers' | 'pool' | 'beachball' | 'leaves' | 'kite';
export interface Line { speaker: Presenter; language: Language; text: string; pauseAfter?: number; direction?: SpeechDirection; }
export interface Skit {
  id: string; title: string; scene: Scene; kind: 'silent' | 'voiced' | 'ident';
  cast: Presenter[]; season?: Season; seconds?: number; lead?: number; tail?: number;
  synopsis: string; lines: Line[]; fact?: string; sources?: string[];
}
export interface Cue extends Line { from: number; frames: number; asset: SpeechAsset; }
export interface Film { skit: Skit; fps: number; durationInFrames: number; logoFrom: number; cues: Cue[]; sfx: string; preview: boolean; }
export function eligibleSkits(skits: readonly Skit[], date: Date): Skit[] {
  const season = seasonAt(date);
  return skits.filter(s => !s.season || s.season === season);
}
