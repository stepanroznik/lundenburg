import React from 'react';
import { ink, Tree, Cloud } from './Scenery.js';

// Held props use the origin as the grip, so the same drawing can rest on a
// surface or move with an articulated hand without jumping between positions.
export function WateringCan({ angle = 0 }: {angle?: number}) {
  return <g transform={`rotate(${angle})`} stroke={ink} strokeWidth="4">
    <path d="M-10 6q-9-39 25-36 40 5 27 56" fill="none" stroke="#0289bb" strokeWidth="10"/>
    <path d="M-61 10h84v72h-84Z" fill="#02aafd"/><ellipse cx="-19" cy="11" rx="42" ry="10" fill="#94dded"/>
    <path d="M-59 36l-62-60-14 11 76 76" fill="#02aafd"/><ellipse cx="-131" cy="-18" rx="11" ry="23" transform="rotate(-42 -131 -18)" fill="#e7e9d7"/>
    <path d="M-142-26l16 13m-11-18l14 12" strokeWidth="2"/>
  </g>;
}
export function Umbrella() {
  return <g stroke={ink} strokeWidth="4"><path d="M0-221V10q0 18 16 10" fill="none" strokeWidth="6"/>
    <path d="M-142-182Q0-352 142-182Q95-206 47-182Q0-206-47-182Q-95-206-142-182Z" fill="#02aafd"/>
    <path d="M0-268Q-39-233-47-182M0-268Q39-233 47-182" stroke="#e3f7fa" strokeWidth="3" fill="none"/>
  </g>;
}
export function Rake() {
  return <g stroke={ink} strokeWidth="4" strokeLinecap="round"><path d="M0-135V152" stroke="#b98b5b" strokeWidth="10"/><path d="M-60 152H60" strokeWidth="9"/>{[-60,-36,-12,12,36,60].map(x=><path key={x} d={`M${x} 152v29l-7 6`} strokeWidth="6"/>)}</g>;
}
export function PoolSurroundings({frame}: {frame:number}) {
  // View across the outdoor basin toward the adjacent indoor swimming hall,
  // residential streets and planted recreation grounds (Veslařská/Fibichova).
  return <><rect width="1920" height="1080" fill="#e5f5f1"/><circle cx="1630" cy="123" r="65" fill="#ffdb68"/>
    <Cloud x={320+frame*.035} y={130}/><Cloud x={1170} y={104} s={.65}/>
    <g stroke="#a4b7ae" strokeWidth="3">{[0,1,2,3,4,5].map((i)=><g key={i} transform={`translate(${i*320-45} ${275+(i%3)*19})`}><rect width="265" height="205" fill={['#e9dcc2','#e8e5d9','#d3ddd8'][i%3]}/><path d="M-12 0L132-61 277 0Z" fill="#b48672"/>{Array.from({length:12},(_,j)=><rect key={j} x={22+j%4*60} y={24+Math.floor(j/4)*53} width="31" height="35" fill="#9dc4cd"/>)}</g>)}</g>
    <rect y="471" width="1920" height="270" fill="#c5dba1"/>
    <g stroke={ink} strokeWidth="3"><path d="M963 350H1870V579H963Z" fill="#dfded7"/><path d="M941 351l91-49h817l40 49Z" fill="#6d787c"/>
      {Array.from({length:12},(_,i)=><path key={i} d={`M${983+i*73} 383h56v105h-56Z`} fill="#95c4cb"/>)}<path d="M975 515h885" stroke="#8f9e99" strokeWidth="10"/>
      <text x="1404" y="554" textAnchor="middle" fontSize="24" fill="#004f4f" stroke="none">KRYTÝ BAZÉN</text>
      <path d="M610 580V330h65v250m-65-225h65m-65 38h65m-65 38h65m-65 38h65m-65 38h65" fill="none" stroke="#7a979c" strokeWidth="6"/>
      <path d="M655 340q118 10 98 61t-123 48q-91-8-85 43t126 43l124 43" fill="none" stroke="#e4a900" strokeWidth="24"/><path d="M655 336q118 10 98 61t-123 48q-91-8-85 43t126 43l124 43" fill="none" stroke="#ffcf37" strokeWidth="15"/>
    </g>
    <Tree x={130} y={653} s={.55}/><Tree x={865} y={643} s={.45}/><Tree x={1890} y={664} s={.58}/>
    {[310,490,900,1170,1500].map(x=><g key={x} stroke={ink} strokeWidth="3"><path d={`M${x} 665v-97`} strokeWidth="5"/><path d={`M${x-65} 574q65-76 130 0Z`} fill="#fbd25d"/><path d={`M${x+22} 669h85l-21-36h-43Z`} fill="#fffbea"/></g>)}
    <rect x="53" y="427" width="386" height="109" rx="17" fill="#fffcf4" stroke={ink} strokeWidth="3"/><text x="246" y="467" textAnchor="middle" fill="#004f4f" fontSize="24">LETNÍ KOUPALIŠTĚ</text><text x="246" y="511" textAnchor="middle" fill="#004f4f" fontSize="38">BŘECLAV</text>
  </>;
}
