import React from 'react';
import { Character, type CharacterProps } from '../../characters/Character.js';
import type { Presenter } from '../../characters/types.js';
import type { Film } from '../model.js';
import { Shadow } from './Scenery.js';

export function Actor({ film, frame, id, x, y = 595, scale = 1.05, flip = false, rotate = 0, shadow = true, freeze, ...pose }: Omit<Partial<CharacterProps>, 'frame' | 'id'> & { film: Film; frame: number; id: Presenter; x: number; y?: number; scale?: number; flip?: boolean; rotate?: number; shadow?: boolean; freeze?: number | undefined }) {
  const cue = film.cues.find(c => c.speaker === id && frame >= c.from && frame < c.from + c.frames);
  const seconds = cue ? (frame - cue.from) / film.fps : -1;
  const mouth = cue?.asset.cues.find(c => seconds >= c.start && seconds < c.end)?.value ?? pose.mouth ?? 'rest';
  return <>
    {shadow && <Shadow x={x} y={y + 294 * scale} r={122 * scale}/>}
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${flip ? -scale : scale} ${scale})`}>
      <Character grounded {...pose} id={id} frame={freeze ?? frame} mouth={mouth}/>
    </g>
  </>;
}
