import React from 'react';
import { presenter, weatherStyle } from '../characters.js';
import type { Mouth, Presenter, WeatherState } from '../model.js';

export function Character({ id, frame, mouth = 'rest', state, pointing, target = [400, -100] }: { id: Presenter; frame: number; mouth?: Mouth; state: WeatherState; pointing: boolean; target?: [number, number] }) {
  const p = presenter(id);
  const style = weatherStyle(state);
  const blink = frame % 137 > 130;
  const energy = id === 'schalinka' ? 1.7 : id === 'haluschka' ? 0.5 : 1;
  const bob = Math.sin(frame / 17) * 2 * energy;
  const fur = id === 'knurpsi' ? '#b97844' : id === 'schalinka' ? '#77ad82' : '#fffaf0';
  const angle = pointing ? Math.atan2(target[1] - 115, target[0] - 65) * 180 / Math.PI : 58 + Math.sin(frame / 19) * 7 * energy;
  const pupil = pointing ? 7 : 0;
  return <g transform={`translate(0 ${bob})`} stroke="#334c49" strokeWidth="4" strokeLinejoin="round">
    {id === 'knurpsi' && <g transform={`rotate(${Math.sin(frame / 20) * 5} -75 215)`}><ellipse cx="-100" cy="205" rx="43" ry="96" fill="#8e644c" transform="rotate(35 -100 205)"/><path d="M-155 220l70-45m-65 70l72-46m-57 71l64-43" opacity=".4" fill="none"/></g>}
    {id === 'schalinka' && <path d="M-65 175Q-190 280-175 150Q-245 325-70 275" fill={fur}/>}
    {id === 'sisi' && <><ellipse cx="-48" cy="-124" rx="28" ry="86" fill={fur} transform="rotate(-10 -48 -124)"/><ellipse cx="45" cy="-125" rx="28" ry="87" fill={fur} transform="rotate(12 45 -125)"/><path d="M-49-177l4 95M48-181l-7 98" stroke="#e2b9bd" strokeWidth="19" strokeLinecap="round"/></>}
    {id === 'knurpsi' && <><circle cx="-72" cy="-69" r="28" fill={fur}/><circle cx="72" cy="-69" r="28" fill={fur}/></>}
    {id === 'haluschka' && <><ellipse cx="-98" cy="-25" rx="40" ry="22" fill="#d4baa8" transform="rotate(20 -98 -25)"/><ellipse cx="98" cy="-25" rx="40" ry="22" fill="#d4baa8" transform="rotate(-20 98 -25)"/></>}
    <ellipse cx="-47" cy="283" rx="47" ry="22" fill={fur}/><ellipse cx="49" cy="283" rx="47" ry="22" fill={fur}/>
    <path d="M-72 87Q-100 158-88 265Q0 299 91 265Q102 170 70 87Z" fill={style.outfit === 'raincoat' ? '#f2c85b' : style.outfit === 'scarf' ? '#678fa1' : p.color}/>
    <path d="M-70 117Q-120 163-94 211" stroke={fur} strokeWidth="32" fill="none" strokeLinecap="round"/>
    {id === 'sisi' && <><path d="M-72 160Q0 190 78 160M-86 252Q0 275 88 252" stroke="#faf0db" strokeWidth="9" fill="none"/><circle cy="99" r="12" fill="#f3d074"/></>}
    {id === 'knurpsi' && <><path d="M-40 100v113h80V100" fill="#5f8892"/><rect x="-27" y="156" width="54" height="43" rx="9" fill="#87b1ba"/></>}
    {id === 'schalinka' && <path d="M-26 107L8 147-4 163l34 43-4-44 17-11-30-47" fill="#ffe8ac" stroke="none"/>}
    {id === 'haluschka' && <path d="M-52 100Q0 145 56 100L72 147Q0 189-71 147Z" fill="#ded4ea"/>}
    <g transform={`translate(67 115) rotate(${angle})`}>
      <path d="M0 0Q38-12 79 0" fill="none" stroke={fur} strokeWidth="32" strokeLinecap="round"/>
      <ellipse cx="90" cy="0" rx="21" ry="19" fill={fur}/>
      {pointing && <path d="M94 0h140" stroke="#40544c" strokeWidth="6" strokeLinecap="round"/>}
    </g>
    {style.outfit === 'scarf' && <><path d="M-72 83Q0 120 74 83l-9 29Q0 142-67 113Z" fill="#eaa178"/><path d="M40 114l-5 78 31 6 6-85" fill="#eaa178"/></>}
    <ellipse cy="0" rx={id === 'schalinka' ? 101 : 89} ry="88" fill={fur}/>
    {id === 'haluschka' && Array.from({ length: 9 }, (_, i) => <circle key={i} cx={Math.cos(i * Math.PI / 8) * 78} cy={-30 - Math.sin(i * Math.PI / 8) * 62} r="27" fill="#fffaf0" stroke="none"/>)}
    {id === 'schalinka' && <><path d="M-75-67l8-29 26 15 19-29 23 26 25-20 9 29" fill="#b2c783"/><ellipse cx="27" cy="30" rx="82" ry="46" fill="#a5c89e"/><circle cx="68" cy="8" r="3" fill="#334c49"/></>}
    {id === 'knurpsi' && <><ellipse cx="-24" cy="37" rx="38" ry="28" fill="#e0b37e"/><ellipse cx="24" cy="37" rx="38" ry="28" fill="#e0b37e"/></>}
    <g fill="#fff" strokeWidth="3"><ellipse cx="-33" cy="-13" rx="20" ry={blink ? 2 : 26}/><ellipse cx="35" cy="-13" rx="20" ry={blink ? 2 : 26}/></g>
    {!blink && <g fill="#283f3d" stroke="none"><ellipse cx={-31 + pupil} cy="-10" rx="9" ry="14"/><ellipse cx={37 + pupil} cy="-10" rx="9" ry="14"/><circle cx={-34 + pupil} cy="-16" r="3" fill="white"/><circle cx={34 + pupil} cy="-16" r="3" fill="white"/></g>}
    <path d="M-53-48q19-8 34 0M18-48q19-8 34 0" fill="none" strokeLinecap="round"/>
    <ellipse cy="17" rx={id === 'knurpsi' ? 18 : 11} ry="9" fill={id === 'sisi' ? '#d9a4af' : '#48534a'}/>
    <g transform={`translate(${id === 'schalinka' ? 12 : 0} 54)`}>
      {mouth === 'rest' || mouth === 'closed' ? <path d="M-20-1Q0 12 20-1" fill="none" strokeLinecap="round"/> : <><ellipse rx={mouth === 'round' ? 12 : mouth === 'wide' ? 28 : 22} ry={mouth === 'open' ? 22 : mouth === 'round' ? 20 : 10} fill="#654443"/><path d="M-10 8q10-7 20 0" stroke="#d99691" strokeWidth="7"/>{mouth === 'teeth' && <rect x="-19" y="-8" width="38" height="10" rx="2" fill="white" stroke="none"/>}</>}
      {id === 'knurpsi' && <path d="M-11 0h22v14h-22ZM0 0v14" fill="#fff7df" strokeWidth="2"/>}
    </g>
    {id === 'sisi' && <path d="M-29-85l-5-25 21 11 14-20 13 20 21-11-5 25Z" fill="#edc86d"/>}
    {style.outfit === 'summer' && id !== 'sisi' && <><ellipse cy="-80" rx="106" ry="13" fill="#ecdca4"/><path d="M-63-84q4-74 65-57 54-16 61 57" fill="#f1e3b5"/></>}
    {style.prop === 'umbrella' && <g transform="translate(-135 0)"><path d="M0-110v330q0 22-20 10" fill="none" stroke="#526761" strokeWidth="7"/><path d="M-96-97q96-140 192 0Q60-119 32-97Q0-119-32-97Q-62-119-96-97" fill="#84bfc2"/></g>}
    {style.prop === 'fan' && <path d="M-96 190l-50-80q50-33 85 11Z" fill="#f2d483"/>}
    {state === 'snow' && [0, 1, 2, 3].map(i => <text key={i} x={-155 + i * 95} y={-180 + (frame * 1.3 + i * 93) % 380} fill="#e7f2ed" stroke="none" fontSize="25">✳</text>)}
    {state === 'windy' && <path d={`M-170 ${-110 + Math.sin(frame / 12) * 9}q60-20 100 0m-80 30h65`} fill="none" stroke="#c2d9d5" strokeWidth="7" strokeLinecap="round"/>}
  </g>;
}
