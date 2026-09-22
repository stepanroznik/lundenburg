import React from 'react';
import type { Season } from '../model.js';

export const ink = '#334c49';
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => { const p = clamp(n); return p * p * (3 - 2 * p); };
export const lerp = (a: number, b: number, p: number) => a + (b - a) * clamp(p);
export function Cloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}><path d="M-92 25Q-124-19-78-36Q-67-88-12-57Q20-90 55-47Q104-50 108-6Q136 32 91 36Z" fill="#fffdf6"/></g>;
}
export function Tree({ x, y, s = 1, winter = false, autumn = false }: { x: number; y: number; s?: number; winter?: boolean; autumn?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`} stroke={ink} strokeWidth="5" strokeLinejoin="round"><path d="M-21 0l7-390h33L28 0Z" fill="#a97857"/><path d="M-2-193l-85-86M5-280l76-77" fill="none" stroke="#a97857" strokeWidth="27"/>
    <path d="M-155-284Q-202-360-129-408Q-154-489-64-494Q-11-565 57-501Q159-512 145-428Q226-371 165-303Q150-251 69-263Q-5-212-57-267Q-125-242-155-284Z" fill={winter ? '#bdd7ce' : autumn ? '#eaaa59' : '#bad58e'}/>
    {winter && <path d="M-155-350Q-184-397-129-419Q-143-490-64-494Q-11-565 57-501Q159-512 145-428Q205-383 167-349Q134-380 95-349Q51-380 14-351Q-24-380-67-346Q-109-375-155-350Z" fill="#fffefa" stroke="none"/>}</g>;
}
export function Outdoor({ season = 'spring', frame = 0, pool = false }: { season?: Season; frame?: number; pool?: boolean }) {
  const winter = season === 'winter';
  return <>
    <rect width="1920" height="1080" fill={winter ? '#e6f0f2' : season === 'autumn' ? '#fff1d9' : '#e5f5f1'}/>
    <circle cx="1510" cy="185" r="73" fill={winter ? '#fff5c6' : '#ffdb68'}/>
    <Cloud x={290 + frame * .05} y={155} s={1.3}/><Cloud x={1110 + frame * .035} y={230} s={.85}/>
    <path d="M0 672Q320 410 662 660Q1080 428 1530 645Q1770 495 1920 609V1080H0Z" fill={winter ? '#ccdeda' : season === 'autumn' ? '#d2d09a' : '#c5deb4'}/>
    <path d="M0 822Q420 713 820 804T1920 775V1080H0Z" fill={winter ? '#fafefa' : season === 'autumn' ? '#e2c18b' : '#dce9bd'}/>
    <Tree x={130} y={851} s={.9} winter={winter} autumn={season === 'autumn'}/><Tree x={1800} y={840} s={.68} winter={winter} autumn={season === 'autumn'}/>
    {!pool && <path d="M0 1008Q395 925 931 1010T1920 986" stroke={winter ? '#d7e8e5' : '#becb9b'} strokeWidth="4" fill="none"/>}
    {winter && Array.from({ length: 25 }, (_, i) => <circle key={i} cx={(i * 173 + frame * .4) % 1920} cy={(i * 113 + frame * .9) % 1080} r={3 + i % 3} fill="#fff"/>)}
  </>;
}
export function Shadow({ x, y, r = 150 }: { x: number; y: number; r?: number }) { return <ellipse cx={x} cy={y} rx={r} ry="21" fill="#004f4f" opacity=".11"/>; }
export function Stick({ x = 0, y = 0, angle = 0, length = 150 }: { x?: number; y?: number; angle?: number; length?: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${angle})`} strokeLinecap="round"><path d={`M${-length / 2} 0H${length / 2}M12 0l25-22`} stroke={ink} strokeWidth="15"/><path d={`M${-length / 2} 0H${length / 2}M12 0l25-22`} stroke="#ab7950" strokeWidth="10"/></g>;
}
export function Leaf({ x = 0, y = 0, angle = 0, s = 1, color = '#eaa44c' }: { x?: number; y?: number; angle?: number; s?: number; color?: string }) {
  return <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${s})`} stroke="#a2764c" strokeWidth="2"><path d="M0 25Q-40 7-18-35Q20-27 24-8Q22 18 0 25Z" fill={color}/><path d="M-9-20L3 35" fill="none"/></g>;
}
export function Splash({ x, y, p, color = '#67bfce' }: { x: number; y: number; p: number; color?: string }) {
  if (p <= 0 || p >= 1) return null;
  return <g opacity={1 - p} fill={color} stroke="#fff" strokeWidth="2">{Array.from({ length: 11 }, (_, i) => {
    const a = Math.PI + i * Math.PI / 10;
    return <ellipse key={i} cx={x + Math.cos(a) * p * (160 + i % 3 * 45)} cy={y + Math.sin(a) * p * 300 + p * p * 140} rx={8 + i % 4} ry="18" transform={`rotate(${(a * 180 / Math.PI) - 90} ${x + Math.cos(a) * p * (160 + i % 3 * 45)} ${y + Math.sin(a) * p * 300 + p * p * 140})`}/>;
  })}</g>;
}
export function BeachBall({ x, y, r = 62, angle = 0 }: { x: number; y: number; r?: number; angle?: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${angle})`} stroke={ink} strokeWidth="4"><circle r={r} fill="#fffcf4"/><path d={`M0 ${-r}Q${r * 1.05} 0 0 ${r}A${r} ${r} 0 0 0 0 ${-r}`} fill="#fb1143"/><path d={`M0 ${-r}Q${-r * 1.1} 0 0 ${r}Q${-r * .1} 0 0 ${-r}`} fill="#02aafd"/><path d={`M0 ${-r}Q${r * .15} 0 0 ${r}Q${r * .65} 0 0 ${-r}`} fill="#fdbf11"/></g>;
}
export function Bench() { return <g stroke={ink} strokeWidth="5"><path d="M1110 755v173m405-173v173" strokeWidth="17"/><rect x="1030" y="662" width="560" height="60" rx="16" fill="#bb8757"/><rect x="1030" y="735" width="560" height="42" rx="12" fill="#c79563"/></g>; }
export function Biscuit({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) { return <g transform={`translate(${x} ${y}) scale(${s})`}><circle r="32" fill="#dfac64" stroke="#9b7049" strokeWidth="4"/>{[[-12,-12],[10,-8],[-6,10],[15,15]].map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r="4" fill="#72533e"/>)}</g>; }
export function Flower({ x, y, scale = 1, angle = 0 }: { x: number; y: number; scale?: number; angle?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${angle} 0 140)`} stroke={ink} strokeWidth="4"><path d="M0 0v140m0-55q-57-1-45-44 33 0 45 44m0-25q52-1 44-40-35 1-44 40" fill="#79c718"/>{[0,1,2,3,4].map(i=><ellipse key={i} cy="-28" rx="21" ry="33" fill="#fb7f87" transform={`rotate(${i*72})`}/>)}<circle r="24" fill="#fdbf11"/></g>;
}
