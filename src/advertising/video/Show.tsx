import React from 'react';
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from 'remotion';
import { Actor } from '../../intermissions/video/Actor.js';
import { Logo } from '../../intermissions/video/Logo.js';
import { Cloud, smooth, lerp, ink } from '../../intermissions/video/Scenery.js';
import { brandColors } from '../../characters/brand.js';
import { presenter } from '../../characters/registry.js';
import { spokenEndFrame } from '../model.js';
import type { Film } from '../../intermissions/model.js';

export interface BumperProps extends Record<string, unknown> { film: Film }

function clapperAngle(frame: number): number {
  return -32 * smooth((frame - 12) / 10) * (1 - smooth((frame - 27) / 5));
}
function clapperGrip(frame: number): [number,number] {
  const a = clapperAngle(frame) * Math.PI / 180;
  return [-95 + 53*Math.cos(a) + 13*Math.sin(a), -90 + 53*Math.sin(a) - 13*Math.cos(a)];
}
function Clapper({ frame }: { frame: number }) {
  const hand = clapperGrip(frame);
  return <g stroke={ink} strokeWidth="4" strokeLinejoin="round">
    <rect x="-95" y="-90" width="190" height="100" rx="9" fill="#e4c38b"/>
    <path d="M-68-46H68m-136 26H22" stroke="#a2784b" strokeWidth="5"/>
    <g transform={`rotate(${clapperAngle(frame)} -95 -90)`}>
      <rect x="-95" y="-119" width="190" height="29" rx="4" fill="#fffcf4"/>
      {[-80,-25,30].map(x => <path key={x} d={`M${x}-119l28 29h26l-28-29Z`} fill="#004f4f" stroke="none"/>)}
    </g><circle cx="-83" cy="-103" r="5" fill="#fd6f04" stroke="none"/>
    <g transform={`translate(${hand[0]} ${hand[1]})`}><ellipse rx="17" ry="18" fill="#b97844"/><path d="M-10-4q10-6 20 0m-20 8q10-6 20 0" fill="none" strokeWidth="2"/></g>
  </g>;
}
function Bell({ frame }: { frame: number }) {
  const ring = frame >= 23 && frame < 38 ? Math.sin((frame-23)*.65) * 17 * (1-smooth((frame-32)/6)) : 0;
  return <g transform={`rotate(${ring})`} stroke={ink} strokeWidth="4">
    <path d="M-8 4V-31q8-13 16 0V4Z" fill="#a97857"/>
    <path d="M-28 28Q-29 6 0 5Q29 6 28 28L42 51H-42Z" fill="#fdbf11"/>
    <ellipse cy="51" rx="42" ry="10" fill="#df9a22"/>
    <circle cx={ring*.5} cy="62" r="8" fill="#004f4f"/>
    <path d="M-15 22q7-8 14-7" stroke="#fff3ba" strokeWidth="5" fill="none"/>
  </g>;
}
function Megaphone() {
  return <g stroke={ink} strokeWidth="4" strokeLinejoin="round">
    <path d="M-10 5l-7-46h23L15 4Z" fill="#fdbf11"/>
    <path d="M-21-68H12L94-98V-25L12-50H-21Z" fill="#02aafd"/>
    <path d="M94-98q17 34 0 73" fill="#fffdf3"/>
    <path d="M-17-63H10v8h-27" fill="#004f4f" stroke="none"/>
    <path d="M23-62l49-17" stroke="#d4f3f9" strokeWidth="5"/>
  </g>;
}
function Gift({ frame, revealFrom }: { frame: number; revealFrom: number }) {
  const open = smooth((frame-revealFrom)/12);
  return <g transform="translate(-80 -40)" stroke={ink} strokeWidth="4">
    <rect x="-80" y="0" width="160" height="98" rx="9" fill="#fb1143"/>
    <path d="M-10 0v98h20V0" fill="#fdbf11" stroke="none"/>
    <g transform={`rotate(${open*-24} -80 0)`}>
      <rect x="-89" y="-24" width="178" height="28" rx="7" fill="#fd6f04"/>
      <path d="M0-24q-57-56-60-16-4 19 60 16q57-56 60-16 4 19-60 16Z" fill="#fdbf11"/>
    </g>
    {open > 0 && <g opacity={open} fill="#fdbf11" stroke="#bf8418" strokeWidth="2">
      {[-42,0,42].map((x,i)=><path key={x} transform={`translate(${10+open*(105+i*30)} ${-15-open*(85+i%2*18)}) scale(.6)`} d="M0-22l7 15 17 2-12 11 3 17-15-8-15 8 3-17-12-11 17-2Z"/>)}
    </g>}
  </g>;
}

export function AdvertisingBumper({ film }: BumperProps) {
  const frame = useCurrentFrame(), id = film.skit.cast[0]!;
  const cue = film.cues[0]!, end = spokenEndFrame(film);
  const presenting = smooth((frame-20)/21), recover = smooth((frame-end-8)/18);
  const speakNod = frame >= cue.from && frame < end ? Math.sin((frame-cue.from)/9)*2 : -2*recover;
  const grip = clapperGrip(frame);
  const leftHand: [number,number] = id === 'knurpsi' ? [123+grip[0],158+grip[1]]
    : id === 'haluschka' ? [-80,171] : [-100+presenting*12,205-presenting*32];
  const rightHand: [number,number] = id === 'schalinka'
    ? [lerp(112,43,presenting)+recover*50,lerp(185,112,presenting)+recover*73]
    : id === 'haluschka' ? [80,171] : [123,158+(id === 'sisi' && frame >=23 && frame <38 ? Math.sin((frame-23)*.65)*7 : 0)];
  const prop = id === 'knurpsi' ? <Clapper frame={frame}/> : id === 'sisi' ? <Bell frame={frame}/>
    : id === 'schalinka' ? <Megaphone/> : <Gift frame={frame} revealFrom={end+8}/>;
  return <AbsoluteFill style={{ background: '#eff8f2', fontFamily: 'Fredoka, sans-serif' }}>
    <svg viewBox="0 0 1920 1080" width="100%" height="100%">
      <rect width="1920" height="1080" fill="#eff8f2"/>
      <path d="M0 0H1920V115Q1380 25 860 127T0 87Z" fill="#cfeee9"/>
      <path d="M0 71Q243 15 431 92" fill="none" stroke="#004f4f" strokeWidth="5"/>
      {[0,1,2,3,4].map(i=><path key={i} d={`M${40+i*70} ${56-i*2}l15 30 17-34Z`} fill={brandColors[4-i]}/>)}
      <Cloud x={175} y={245} s={1.05}/><Cloud x={1690} y={190} s={.9}/>
      <path d="M0 876Q270 784 640 858T1920 873V1080H0Z" fill="#d6e9ce"/>
      <path d="M0 986Q330 904 820 994T1920 989V1080H0Z" fill="#c5dfba"/>
      <path d="M0 1064Q195 991 423 1051" stroke="#8db873" strokeWidth="4" fill="none"/>
      <g transform="translate(115 942)"><path d="M0 0v65m0-17q-34 0-35-30 31 0 35 30m0-20q29 1 31-26-29 0-31 26" fill="#79c718" stroke="#668d53" strokeWidth="3"/>
        {[0,1,2,3,4].map(i=><ellipse key={i} cy="-19" rx="13" ry="23" fill="#fd6f04" transform={`rotate(${i*72})`}/>)}<circle r="14" fill="#fdbf11"/></g>
      <path d="M816 222Q1190 183 1775 246L1748 475Q1270 437 804 473Z" fill="#fffdf1"/>
      {'WERBUNG'.split('').map((letter,i)=>{
        const p = smooth((frame-6-i*2)/12);
        return <text key={i} x={910+i*126} y={402-(1-p)*36} opacity={p} textAnchor="middle" fontSize="142" fontWeight="650"
          fill={brandColors[[5,4,3,2,1,0,5][i]!]!} stroke="#fffdf1" strokeWidth="5" paintOrder="stroke"
          transform={`rotate(${[-3,2,-2,3,-2,2,-2][i]} ${910+i*126} 365)`}>{letter}</text>;
      })}
      <Actor film={film} frame={frame} id={id} x={465} y={548} scale={1.25} look={id === 'haluschka' && frame > end+8 ? 7 : frame < 40 ? 3 : 0}
        tilt={speakNod} bend={id === 'knurpsi' && frame <32 ? -smooth(frame/12)*2 : 0}
        leftHand={leftHand} rightHand={rightHand} rightProp={prop} foregroundHands={id !== 'sisi'}
        emotion={id === 'haluschka' && frame > end+8 && frame < end+26 ? 'surprised' : 'happy'}/>
      {/* The actor remains visible beside the same animated logo used by the channel ident. */}
      {frame >= film.logoFrom && <svg x="785" y="477" width="1070" height="560" viewBox="0 0 1920 1080">
        <path d="M210 242C147 113 499 110 728 157S1298 68 1558 200S1832 550 1650 752S1094 862 826 897S202 822 159 635S273 371 210 242Z" fill="#fffdf1"/>
        <Logo frame={frame-film.logoFrom} starts={[0,10,20]} background={false}/>
      </svg>}
      <path d="M279 976l373-8 14 71-379 13Z" fill="#ffe6a1" stroke="#debc72" strokeWidth="2"/>
      <circle cx="300" cy="991" r="7" fill="#fb1143"/>
      <text x="469" y="1023" textAnchor="middle" fill="#004f4f" fontSize="36" fontWeight="500">{presenter(id).name}</text>
      {id === 'sisi' && frame >=26 && frame <38 && <g stroke="#fdbf11" strokeWidth="5" strokeLinecap="round" opacity={Math.sin((frame-26)/12*Math.PI)}>
        <path d="M679 753l19-8m-20 47l21 8"/></g>}
    </svg>
    <Audio src={staticFile(`intermissions/audio/${film.skit.id}.wav`)}/>
  </AbsoluteFill>;
}
