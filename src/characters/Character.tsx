import React from 'react';
import { presenter, personalities } from './registry.js';
import type { Mouth, Presenter } from './types.js';

export interface CharacterProps {
  id: Presenter; frame: number; mouth?: Mouth;
  outfit?: 'everyday' | 'scarf' | 'raincoat' | 'summer' | 'bathing' | 'swimsuit';
  prop?: 'none' | 'umbrella' | 'fan' | 'pointer';
  pointing?: boolean; target?: [number, number]; ambient?: 'snow' | 'wind';
  look?: number; tilt?: number; arm?: number; leftArm?: number;
  emotion?: 'happy' | 'surprised' | 'unimpressed' | 'thinking';
  rightProp?: React.ReactNode; leftProp?: React.ReactNode; walk?: boolean;
  grounded?: boolean; crouch?: number; bend?: number; stride?: number;
  rightHand?: [number, number]; leftHand?: [number, number];
  rightPropAngle?: number; leftPropAngle?: number;
}
export function Character({ id, frame, mouth = 'rest', outfit = 'everyday', prop = 'none', pointing = false, target = [400, -100], ambient, look, tilt, arm, leftArm = 0, emotion = 'happy', rightProp, leftProp, walk = false, grounded = false, crouch = 0, bend = 0, stride, rightHand, leftHand, rightPropAngle = 0, leftPropAngle = 0 }: CharacterProps) {
  const p = presenter(id);
  const style = { outfit, prop };
  const blink = frame % 137 > 130;
  const energy = personalities[id].energy;
  const bob = grounded ? 0 : Math.sin(frame / 17) * 2 * energy;
  const fur = id === 'knurpsi' ? '#b97844' : id === 'schalinka' ? '#77ad82' : id === 'sisi' ? '#ffffff' : '#fffaf0';
  const angle = arm ?? (pointing ? Math.atan2(target[1] - 115, target[0] - 65) * 180 / Math.PI : 58 + Math.sin(frame / 19) * 7 * energy);
  const pupil = look ?? (pointing ? 7 : Math.sin(frame / 53) * 2);
  const sway = grounded ? 0 : Math.sin(frame / 43) * energy * .8;
  const headTilt = tilt ?? ((pointing ? 3 : -1) + Math.sin(frame / 29) * energy * 1.4);
  const mouthHeight = mouth === 'open' ? 22 : mouth === 'round' ? 20 : mouth === 'rest' || mouth === 'closed' ? 0 : 10;
  const mouthWidth = mouth === 'round' ? 12 : mouth === 'wide' ? 28 : 22;
  const grip = { x: -116, y: 178 };
  const step = walk ? Math.sin(stride ?? frame / 3) : 0;
  const heldArm = (side: number, hand: [number, number], held: React.ReactNode, propAngle: number) => {
    const shoulder = side * 67;
    const elbowX = (shoulder + hand[0]) / 2 + side * 22;
    const elbowY = Math.max(145, (115 + hand[1]) / 2 + 36);
    const d = `M${shoulder} 115Q${elbowX} ${elbowY} ${hand[0]} ${hand[1]}`;
    return <g><path d={d} fill="none" stroke="#334c49" strokeWidth="38" strokeLinecap="round"/><path d={d} fill="none" stroke={fur} strokeWidth="31" strokeLinecap="round"/>
      <g transform={`translate(${hand[0]} ${hand[1]}) rotate(${propAngle})`}>{held}<ellipse rx="17" ry="18" fill={fur}/><path d="M-10-4q10-6 20 0m-20 8q10-6 20 0" fill="none" strokeWidth="2"/></g></g>;
  };

  return <g transform={`rotate(${sway} 0 283) translate(0 ${bob})`} stroke="#334c49" strokeWidth="4" strokeLinejoin="round">
    {grounded && <g fill="none" strokeLinecap="round"><path d={`M-46 ${240+crouch*20}Q${-60-crouch*35} ${256-crouch*13} ${-47+step*22} ${283-Math.max(0,step)*12}M46 ${240+crouch*20}Q${60+crouch*35} ${256-crouch*13} ${49-step*22} ${283-Math.max(0,-step)*12}`} stroke={fur} strokeWidth="31"/></g>}
    <ellipse cx={-47+(grounded?step*22:0)} cy={283-(grounded?Math.max(0,step)*12:-step*13)} rx="47" ry="22" fill={fur}/><ellipse cx={49-(grounded?step*22:0)} cy={283-(grounded?Math.max(0,-step)*12:step*13)} rx="47" ry="22" fill={fur}/>
    <g transform={`translate(0 265) scale(1 ${1-crouch*.36}) rotate(${bend}) translate(0 -265)`}>
    {id === 'knurpsi' && <g transform={`rotate(${Math.sin(frame / 20) * 5} -75 215)`}><ellipse cx="-100" cy="205" rx="43" ry="96" fill="#8e644c" transform="rotate(35 -100 205)"/><path d="M-155 220l70-45m-65 70l72-46m-57 71l64-43" opacity=".4" fill="none"/></g>}
    {id === 'schalinka' && <g transform={`rotate(${Math.sin(frame / 16) * 5} -65 200)`}><path d="M-65 175Q-190 280-175 150Q-245 325-70 275" fill={fur}/></g>}
    <path d="M-72 87Q-100 158-88 265Q0 299 91 265Q102 170 70 87Z" fill={style.outfit === 'bathing' ? fur : style.outfit === 'swimsuit' ? '#02aafd' : style.outfit === 'raincoat' ? '#f2c85b' : style.outfit === 'scarf' ? '#678fa1' : p.color}/>
    {leftHand ? heldArm(-1, leftHand, leftProp, leftPropAngle) : <g transform={`rotate(${leftArm + (grounded?0:Math.sin(frame / 39) * 1.5)} -70 117)`}>
      <path d={style.prop === 'umbrella' || style.prop === 'fan' ? `M-70 117Q-125 132 ${grip.x} ${grip.y}` : 'M-70 117Q-120 163-94 211'} stroke="#334c49" strokeWidth="38" fill="none" strokeLinecap="round"/>
      <path d={style.prop === 'umbrella' || style.prop === 'fan' ? `M-70 117Q-125 132 ${grip.x} ${grip.y}` : 'M-70 117Q-120 163-94 211'} stroke={fur} strokeWidth="32" fill="none" strokeLinecap="round"/>
      {style.prop === 'umbrella' && <g transform={`translate(${grip.x} ${grip.y})`}>
        <path d="M0-280V30q0 20-17 10" fill="none" stroke="#004f4f" strokeWidth="6"/>
        <path d="M-91-263Q0-385 91-263Q61-281 30-263Q0-281-30-263Q-61-281-91-263" fill="#02aafd"/>
        <path d="M0-324Q-25-303-30-263M0-324Q25-303 30-263" fill="none" stroke="#e8f7f5" strokeWidth="2"/>
        <ellipse cy="0" rx="17" ry="20" fill={fur}/><path d="M-9-8q14-5 19 3m-19 6q14-5 19 3" fill="none" strokeWidth="2"/>
      </g>}
      {leftProp && <g transform={`translate(${grip.x} ${grip.y})`}>{leftProp}</g>}
      {style.prop === 'fan' && <g transform={`translate(${grip.x} ${grip.y}) rotate(${Math.sin(frame/5)*9})`}><path d="M0 0l-36-63q40-24 71 0Z" fill="#fdbf11"/><path d="M0 0v-65m0 65l-20-63m20 63l20-63" stroke="#edac3b" strokeWidth="2"/><ellipse rx="13" ry="15" fill={fur}/></g>}
    </g>}
    {!['bathing', 'swimsuit'].includes(outfit) && id === 'sisi' && <><path d="M-72 160Q0 190 78 160M-86 252Q0 275 88 252" stroke="#faf0db" strokeWidth="9" fill="none"/><circle cy="99" r="12" fill="#f3d074"/></>}
    {!['bathing', 'swimsuit'].includes(outfit) && id === 'knurpsi' && <><path d="M-40 100v113h80V100" fill="#5f8892"/><rect x="-27" y="156" width="54" height="43" rx="9" fill="#87b1ba"/></>}
    {!['bathing', 'swimsuit'].includes(outfit) && id === 'schalinka' && <path d="M-26 107L8 147-4 163l34 43-4-44 17-11-30-47" fill="#ffe8ac" stroke="none"/>}
    {!['bathing', 'swimsuit'].includes(outfit) && id === 'haluschka' && <path d="M-52 100Q0 145 56 100L72 147Q0 189-71 147Z" fill="#ded4ea"/>}
    {rightHand ? heldArm(1, rightHand, rightProp, rightPropAngle) : <g transform={`translate(67 115) rotate(${angle})`}>
      <path d="M0 0Q38-12 79 0" fill="none" stroke="#334c49" strokeWidth="38" strokeLinecap="round"/>
      <path d="M0 0Q38-12 79 0" fill="none" stroke={fur} strokeWidth="32" strokeLinecap="round"/>
      <ellipse cx="90" cy="0" rx="21" ry="19" fill={fur}/>
      {rightProp && <g transform="translate(90 0)">{rightProp}</g>}
      {pointing && <path d="M94 0h140" stroke="#40544c" strokeWidth="6" strokeLinecap="round"/>}
    </g>}
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
    {!blink && id === 'sisi' && <g fill="#279bd8" stroke="#176b96" strokeWidth="1.5"><ellipse cx={-31 + pupil} cy="-10" rx="14" ry="20"/><ellipse cx={37 + pupil} cy="-10" rx="14" ry="20"/></g>}
    {!blink && <g fill="#283f3d" stroke="none"><ellipse cx={-31 + pupil} cy="-10" rx="9" ry="14"/><ellipse cx={37 + pupil} cy="-10" rx="9" ry="14"/><circle cx={-34 + pupil} cy="-16" r="3" fill="white"/><circle cx={34 + pupil} cy="-16" r="3" fill="white"/></g>}
    <path d={emotion === 'unimpressed' ? 'M-53-46l34 4M18-42l34-4' : emotion === 'surprised' ? 'M-53-56q19-15 34 0M18-56q19-15 34 0' : emotion === 'thinking' ? 'M-53-55q19-8 34 0M18-42l34-4' : 'M-53-48q19-8 34 0'} fill="none" strokeLinecap="round"/>
    <ellipse cy="17" rx={id === 'knurpsi' ? 18 : 11} ry="9" fill={id === 'sisi' ? '#d9a4af' : '#48534a'}/>
    <g transform={`translate(${id === 'schalinka' ? 12 : 0} 54)`}>
      {id === 'knurpsi' ? mouth === 'rest' || mouth === 'closed' ? <>
        <path d="M-11 1v13q11 4 22 0V1M0 1v14" fill="#fff7df" strokeWidth="2"/>
        <path d={emotion === 'unimpressed' ? 'M-18 5h36' : 'M-20-1Q0 12 20-1'} fill="none" strokeLinecap="round"/>
      </> : <>
        <ellipse rx={mouthWidth} ry={mouthHeight} fill="#654443" stroke="none"/>
        <path d="M-10 8q10-7 20 0" stroke="#d99691" strokeWidth="7"/>
        <path d={`M${-Math.min(11, mouthWidth * .68)} ${-mouthHeight * .7}v${Math.min(14, mouthHeight * 1.15)}q${Math.min(11, mouthWidth * .68)} 4 ${Math.min(22, mouthWidth * 1.36)} 0v-${Math.min(14, mouthHeight * 1.15)}ZM0 ${-mouthHeight * .7}v${Math.min(15, mouthHeight * 1.2)}`} fill="#fff7df" strokeWidth="2"/>
        <ellipse rx={mouthWidth} ry={mouthHeight} fill="none"/>
      </> : mouth === 'rest' || mouth === 'closed' ? <path d={emotion === 'unimpressed' ? 'M-18 5h36' : 'M-20-1Q0 12 20-1'} fill="none" strokeLinecap="round"/> : <><ellipse rx={mouthWidth} ry={mouthHeight} fill="#654443"/><path d="M-10 8q10-7 20 0" stroke="#d99691" strokeWidth="7"/>{mouth === 'teeth' && <rect x="-19" y="-8" width="38" height="10" rx="2" fill="white" stroke="none"/>}</>}
    </g>
    {id === 'sisi' && <path d="M-29-85l-5-25 21 11 14-20 13 20 21-11-5 25Z" fill="#edc86d"/>}
    {style.outfit === 'summer' && id !== 'sisi' && <><ellipse cy="-80" rx="106" ry="13" fill="#ecdca4"/><path d="M-63-84q4-74 65-57 54-16 61 57" fill="#f1e3b5"/></>}
    </g>
    </g>
    {ambient === 'snow' && [0, 1, 2, 3].map(i => <g key={i} transform={`translate(${-155+i*95} ${-180+(frame*1.3+i*93)%380}) rotate(${frame/2+i*17})`} stroke="#3098bc" strokeWidth="2.4" strokeLinecap="round"><path d="M-9 0H9M-4.5-8l9 16M-4.5 8l9-16"/><circle r="2" fill="white" strokeWidth="1"/></g>)}
    {ambient === 'wind' && <path d={`M-170 ${-110 + Math.sin(frame / 12) * 9}q60-20 100 0m-80 30h65`} fill="none" stroke="#c2d9d5" strokeWidth="7" strokeLinecap="round"/>}
  </g>;
}
