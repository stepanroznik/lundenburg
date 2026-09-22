import React from 'react';
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from 'remotion';
import type { Film } from '../model.js';
import { Logo } from './Logo.js';
import { SilentScene } from './Silent.js';
import { VoicedScene } from './Voiced.js';

export interface SkitProps extends Record<string, unknown> { film: Film; }
export function Intermission({ film }: SkitProps) {
  const frame = useCurrentFrame();
  const logo = film.skit.kind === 'ident' || frame >= film.logoFrom;
  return <AbsoluteFill style={{ fontFamily: 'Fredoka, sans-serif', background: '#fffcf4' }}>
    {logo ? <Logo frame={film.skit.kind === 'ident' ? frame : 999} {...(film.skit.kind === 'ident' ? { starts: film.cues.map(c=>c.from) } : {})} {...(film.skit.fact ? { fact: film.skit.fact } : {})}/> :
      <svg viewBox="0 0 1920 1080" width="100%" height="100%">
        {film.skit.kind === 'silent' ? <SilentScene film={film} frame={frame}/> : <VoicedScene film={film} frame={frame}/>}
      </svg>}
    <Audio src={staticFile(`intermissions/audio/${film.skit.id}${film.preview?'.preview':''}.wav`)}/>
  </AbsoluteFill>;
}
