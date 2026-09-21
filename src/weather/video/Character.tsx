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
  const pupil = pointing ? 7 : Math.sin(frame / 53) * 2;
  const sway = Math.sin(frame / 43) * energy * .8;
  const headTilt = (pointing ? 3 : -1) + Math.sin(frame / 29) * energy * 1.4;
  const mouthHeight = mouth === 'open' ? 22 : mouth === 'round' ? 20 : mouth === 'rest' || mouth === 'closed' ? 0 : 10;
  const grip = { x: -116, y: 178 };

  return <g transform={`rotate(${sway} 0 283) translate(0 ${bob})`} stroke="#334c49" strokeWidth="4" strokeLinejoin="round">
    {id === 'knurpsi' && <g transform={`rotate(${Math.sin(frame / 20) * 5} -75 215)`}><ellipse cx="-100" cy="205" rx="43" ry="96" fill="#8e644c" transform="rotate(35 -100 205)"/><path d="M-155 220l70-45m-65 70l72-46m-57 71l64-43" opacity=".4" fill="none"/></g>}
    {id === 'schalinka' && <g transform={`rotate(${Math.sin(frame / 16) * 5} -65 200)`}><path d="M-65 175Q-190 280-175 150Q-245 325-70 275" fill={fur}/></g>}
    <ellipse cx="-47" cy="283" rx="47" ry="22" fill={fur}/><ellipse cx="49" cy="283" rx="47" ry="22" fill={fur}/>
    <path d="M-72 87Q-100 158-88 265Q0 299 91 265Q102 170 70 87Z" fill={style.outfit === 'raincoat' ? '#f2c85b' : style.outfit === 'scarf' ? '#678fa1' : p.color}/>
    <g transform={`rotate(${Math.sin(frame / 39) * 1.5} -70 117)`}>
      <path d={style.prop === 'umbrella' || style.prop === 'fan' ? `M-70 117Q-125 132 ${grip.x} ${grip.y}` : 'M-70 117Q-120 163-94 211'} stroke="#334c49" strokeWidth="38" fill="none" strokeLinecap="round"/>
      <path d={style.prop === 'umbrella' || style.prop === 'fan' ? `M-70 117Q-125 132 ${grip.x} ${grip.y}` : 'M-70 117Q-120 163-94 211'} stroke={fur} strokeWidth="32" fill="none" strokeLinecap="round"/>
      {style.prop === 'umbrella' && <g transform={`translate(${grip.x} ${grip.y})`}>
        <path d="M0-280V30q0 20-17 10" fill="none" stroke="#004f4f" strokeWidth="6"/>
        <path d="M-91-263Q0-385 91-263Q61-281 30-263Q0-281-30-263Q-61-281-91-263" fill="#02aafd"/>
        <path d="M0-324Q-25-303-30-263M0-324Q25-303 30-263" fill="none" stroke="#e8f7f5" strokeWidth="2"/>
        <ellipse cy="0" rx="17" ry="20" fill={fur}/><path d="M-9-8q14-5 19 3m-19 6q14-5 19 3" fill="none" strokeWidth="2"/>
      </g>}
      {style.prop === 'fan' && <g transform={`translate(${grip.x} ${grip.y}) rotate(${Math.sin(frame/5)*9})`}><path d="M0 0l-36-63q40-24 71 0Z" fill="#fdbf11"/><path d="M0 0v-65m0 65l-20-63m20 63l20-63" stroke="#edac3b" strokeWidth="2"/><ellipse rx="13" ry="15" fill={fur}/></g>}
    </g>
    {id === 'sisi' && <><path d="M-72 160Q0 190 78 160M-86 252Q0 275 88 252" stroke="#faf0db" strokeWidth="9" fill="none"/><circle cy="99" r="12" fill="#f3d074"/></>}
    {id === 'knurpsi' && <><path d="M-40 100v113h80V100" fill="#5f8892"/><rect x="-27" y="156" width="54" height="43" rx="9" fill="#87b1ba"/></>}
    {id === 'schalinka' && <path d="M-26 107L8 147-4 163l34 43-4-44 17-11-30-47" fill="#ffe8ac" stroke="none"/>}
    {id === 'haluschka' && <path d="M-52 100Q0 145 56 100L72 147Q0 189-71 147Z" fill="#ded4ea"/>}
    <g transform={`translate(67 115) rotate(${angle})`}>
      <path d="M0 0Q38-12 79 0" fill="none" stroke="#334c49" strokeWidth="38" strokeLinecap="round"/>
      <path d="M0 0Q38-12 79 0" fill="none" stroke={fur} strokeWidth="32" strokeLinecap="round"/>
      <ellipse cx="90" cy="0" rx="21" ry="19" fill={fur}/>
      {pointing && <path d="M94 0h140" stroke="#40544c" strokeWidth="6" strokeLinecap="round"/>}
    </g>
    {style.outfit === 'scarf' && <><path d="M-72 83Q0 120 74 83l-9 29Q0 142-67 113Z" fill="#eaa178"/><path d="M40 114l-5 78 31 6 6-85" fill="#eaa178"/></>}
    <g transform={`rotate(${headTilt} 0 80)`}>
    {id === 'sisi' && <><ellipse cx="-48" cy="-124" rx="28" ry="86" fill={fur} transform="rotate(-10 -48 -124)"/><ellipse cx="45" cy="-125" rx="28" ry="87" fill={fur} transform="rotate(12 45 -125)"/><path d="M-49-177l4 95M48-181l-7 98" stroke="#e2b9bd" strokeWidth="19" strokeLinecap="round"/></>}
    {id === 'knurpsi' && <><circle cx="-72" cy="-69" r="28" fill={fur}/><circle cx="72" cy="-69" r="28" fill={fur}/></>}
    {id === 'haluschka' && <><ellipse cx="-98" cy="-25" rx="40" ry="22" fill="#d4baa8" transform="rotate(20 -98 -25)"/><ellipse cx="98" cy="-25" rx="40" ry="22" fill="#d4baa8" transform="rotate(-20 98 -25)"/></>}
    <ellipse cy="0" rx={id === 'schalinka' ? 101 : 89} ry="88" fill={fur}/>
    {id === 'haluschka' && <><path d="M-97-15Q-115-40-87-57Q-89-91-57-90Q-41-121-14-101Q10-126 33-102Q68-110 75-82Q109-75 96-48Q124-21 99-5" fill="#fffaf0" strokeWidth="3.5"/><path d="M-59-66q-13 17 6 21m28-38q-12 12 3 21m28-23q-7 15 10 19m21-5q-9 15 7 20" fill="none" stroke="#bdcfc4" strokeWidth="2"/></>}
    {id === 'schalinka' && <><path d="M-75-67l8-29 26 15 19-29 23 26 25-20 9 29" fill="#b2c783"/><ellipse cx="27" cy="30" rx="82" ry="46" fill="#a5c89e"/><circle cx="68" cy="8" r="3" fill="#334c49"/></>}
    {id === 'knurpsi' && <><ellipse cx="-24" cy="37" rx="38" ry="28" fill="#e0b37e"/><ellipse cx="24" cy="37" rx="38" ry="28" fill="#e0b37e"/></>}
    <g fill="#fff" strokeWidth="3"><ellipse cx="-33" cy="-13" rx="20" ry={blink ? 2 : 26}/><ellipse cx="35" cy="-13" rx="20" ry={blink ? 2 : 26}/></g>
    {!blink && <g fill="#283f3d" stroke="none"><ellipse cx={-31 + pupil} cy="-10" rx="9" ry="14"/><ellipse cx={37 + pupil} cy="-10" rx="9" ry="14"/><circle cx={-34 + pupil} cy="-16" r="3" fill="white"/><circle cx={34 + pupil} cy="-16" r="3" fill="white"/></g>}
    <path d="M-53-48q19-8 34 0M18-48q19-8 34 0" fill="none" strokeLinecap="round"/>
    <ellipse cy="17" rx={id === 'knurpsi' ? 18 : 11} ry="9" fill={id === 'sisi' ? '#d9a4af' : '#48534a'}/>
    <g transform={`translate(${id === 'schalinka' ? 12 : 0} 54)`}>
      {mouth === 'rest' || mouth === 'closed' ? <path d="M-20-1Q0 12 20-1" fill="none" strokeLinecap="round"/> : <><ellipse rx={mouth === 'round' ? 12 : mouth === 'wide' ? 28 : 22} ry={mouth === 'open' ? 22 : mouth === 'round' ? 20 : 10} fill="#654443"/><path d="M-10 8q10-7 20 0" stroke="#d99691" strokeWidth="7"/>{mouth === 'teeth' && <rect x="-19" y="-8" width="38" height="10" rx="2" fill="white" stroke="none"/>}</>}
      {id === 'knurpsi' && <g transform={`translate(0 ${-mouthHeight})`}><path d="M-11 0h22v14q-11 4-22 0ZM0 0v15" fill="#fff7df" strokeWidth="2"/><path d="M-14-1Q0-5 14-1" fill="none" strokeWidth="3"/></g>}
    </g>
    {id === 'sisi' && <path d="M-29-85l-5-25 21 11 14-20 13 20 21-11-5 25Z" fill="#edc86d"/>}
    {style.outfit === 'summer' && id !== 'sisi' && <><ellipse cy="-80" rx="106" ry="13" fill="#ecdca4"/><path d="M-63-84q4-74 65-57 54-16 61 57" fill="#f1e3b5"/></>}
    </g>
    {state === 'snow' && [0, 1, 2, 3].map(i => <g key={i} transform={`translate(${-155+i*95} ${-180+(frame*1.3+i*93)%380}) rotate(${frame/2+i*17})`} stroke="#3098bc" strokeWidth="2.4" strokeLinecap="round"><path d="M-9 0H9M-4.5-8l9 16M-4.5 8l9-16"/><circle r="2" fill="white" strokeWidth="1"/></g>)}
    {state === 'windy' && <path d={`M-170 ${-110 + Math.sin(frame / 12) * 9}q60-20 100 0m-80 30h65`} fill="none" stroke="#c2d9d5" strokeWidth="7" strokeLinecap="round"/>}
  </g>;
}
