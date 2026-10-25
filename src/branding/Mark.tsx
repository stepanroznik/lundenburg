import React from 'react';
import { nacht } from './identity.js';

export function Moon({ id = 'ln-moon', phase = 1, color = nacht.colors.gold }: { id?: string; phase?: number; color?: string }) {
  const m = nacht.mark.moon;
  return <g>
    <defs><mask id={id} maskUnits="userSpaceOnUse" x="260" y="0" width="180" height="180">
      <rect x="260" width="180" height="180" fill="white"/>
      <circle cx={m.cutX + (1 - phase) * 160} cy={m.cutY - (1 - phase) * 100} r={m.cutRadius} fill="black"/>
    </mask></defs>
    <circle cx={m.x} cy={m.y} r={m.radius} fill={color} mask={`url(#${id})`}/>
  </g>;
}

export function NachtMark({ id = 'ln', letters = 1, moon = 1, stars = true, monochrome = false }: {
  id?: string; letters?: number; moon?: number; stars?: boolean; monochrome?: boolean;
}) {
  return <g>
    <path d={nacht.mark.letters} fill={nacht.colors.ivory} opacity={letters}/>
    <g opacity={moon}><Moon id={`${id}-cut`} color={monochrome ? nacht.colors.ivory : nacht.colors.gold}/>
      {stars && <g fill={monochrome ? nacht.colors.ivory : nacht.colors.gold}>
        <circle cx="421" cy="18" r="3.6"/><circle cx="429" cy="134" r="2.2"/>
      </g>}
    </g>
  </g>;
}

/** Fully transparent, with generous crop-safe bounds. No opaque crescent cutout. */
export function LogoSvg({ monochrome = false }: { monochrome?: boolean }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 180" width="440" height="180" role="img" aria-label={nacht.name}>
    <title>{nacht.name}</title><NachtMark monochrome={monochrome}/>
  </svg>;
}
