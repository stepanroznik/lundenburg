import React from 'react';
import { brandColors } from '../characters/brand.js';
import { Logo } from '../intermissions/video/Logo.js';
import { Moon, NachtMark } from './Mark.js';
import { nacht, programmeBlocks, type BrandFilm, type ProgrammeBlock } from './identity.js';

export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const ease = (n: number) => { const p = clamp(n); return p * p * p * (p * (p * 6 - 15) + 10); };
const ramp = (t: number, start: number, end: number) => ease((t - start) / (end - start));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
function color(a: string, b: string, p: number): string {
  return `#${[1, 3, 5].map(i => Math.round(lerp(parseInt(a.slice(i, i + 2), 16), parseInt(b.slice(i, i + 2), 16), p)).toString(16).padStart(2, '0')).join('')}`;
}
const c = nacht.colors;
const positions = [[245, 155, 2], [481, 329, 1.4], [1518, 193, 2.4], [1655, 412, 1.5], [1354, 115, 1.6], [334, 644, 1.4], [1588, 710, 1.7]];

export function NightField({ t = 0, opacity = 1 }: { t?: number; opacity?: number }) {
  return <g opacity={opacity}>
    <defs><radialGradient id="night-field" cx="65%" cy="84%" r="85%"><stop stopColor={c.horizon}/><stop offset=".55" stopColor={c.midnight}/><stop offset="1" stopColor={c.ink}/></radialGradient></defs>
    <rect width="1920" height="1080" fill="url(#night-field)"/>
    {/* Quiet contours suggest the Morava/Thaya floodplain without inventing a skyline. */}
    {[0, 1, 2].map(i => <path key={i} d={`M-100 ${870 + i * 45} C410 ${730 + i * 48},960 ${1070 + i * 24},2020 ${725 + i * 90}`}
      fill="none" stroke={c.gold} strokeWidth={i === 0 ? 1.8 : 1} opacity={.13 - i * .035}/>) }
    {positions.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={c.ivory} opacity={.35 + .15 * Math.sin(t * .35 + i)}/>) }
  </g>;
}

function Lockup({ t, start = 0, includeMoon = true, label = 'LUNDENBURG NACHT' }: { t: number; start?: number; includeMoon?: boolean; label?: string }) {
  const p = ramp(t, start, start + 1.3);
  return <g>
    <g transform={`translate(630 ${345 + (1 - p) * 28}) scale(1.5)`}>
      <NachtMark id="hero" letters={p} moon={includeMoon ? p : 0}/>
    </g>
    <path d={`M642 665H${642 + 636 * ramp(t, start + .2, start + 1.7)}`} stroke={c.gold} strokeWidth="2" opacity={p}/>
    <text x="960" y="730" textAnchor="middle" fontFamily={nacht.fonts.sans} fontSize="32" letterSpacing="8" fill={c.ivory} opacity={ramp(t, start + .4, start + 1.8)}>{label}</text>
  </g>;
}

function Evening({ t }: { t: number }) {
  const fold = ramp(t, .7, 3.2), orbit = ramp(t, 1.5, 4.8), settle = ramp(t, 4.8, 6.4);
  const orbitX = lerp(960, 1158, settle), orbitY = lerp(490, 469.5, settle);
  return <>
    <rect width="1920" height="1080" fill="#fffcf4"/>
    <NightField t={t} opacity={ramp(t, 1.3, 4.5)}/>
    <g opacity={1 - ramp(t, 1.4, 3.0)} transform={`translate(${960 * fold * .78} ${490 * fold * .78}) scale(${1 - fold * .78})`}>
      <Logo frame={999} background={false}/>
    </g>
    <g transform={`translate(${orbitX} ${orbitY})`} opacity={ramp(t, 1.15, 2.6) * (1 - ramp(t, 4.4, 5.35))}>
      {brandColors.map((v, i) => {
        const r = lerp(315 - i * 28, 109.5, orbit);
        const span = lerp(2.7, 5.85, orbit);
        return <circle key={v} r={r} fill="none" stroke={color(v, c.gold, ramp(t, 2.45, 4.2))}
          strokeWidth={lerp(19, 2, orbit)} strokeLinecap="round" strokeDasharray={`${r * span} ${r * Math.PI * 2}`}
          transform={`rotate(${i * 48 + 220 * orbit})`} opacity={1 - orbit * i * .12}/>;
      })}
    </g>
    <g transform={`translate(${orbitX - 528} ${orbitY - 124.5}) scale(1.5)`} opacity={ramp(t, 4.1, 5.1)}>
      <Moon phase={ramp(t, 4.6, 6.0)} id="evening-moon"/>
      <g fill={c.gold} opacity={ramp(t, 6.1, 7.1)}><circle cx="421" cy="18" r="3.6"/><circle cx="429" cy="134" r="2.2"/></g>
    </g>
    <Lockup t={t} start={5.9} includeMoon={false}/>
    <text x="960" y="841" textAnchor="middle" fontFamily={nacht.fonts.serif} fontSize="35" fill={c.gold} opacity={ramp(t, 7.1, 8.3)}>Der Abend gehört den Entdeckern.</text>
  </>;
}

function Morning({ t }: { t: number }) {
  const descend = ramp(t, .7, 3.7), sunrise = ramp(t, 2.1, 5.5), unfold = ramp(t, 4.1, 6.8);
  return <>
    <NightField t={t}/>
    <g opacity={1 - ramp(t, .6, 2.0)}><Lockup t={10} includeMoon={false}/></g>
    <defs><clipPath id="horizon-clip"><rect width="1920" height="720"/></clipPath>
      <radialGradient id="daybreak" cx="50%" cy="66%" r="75%"><stop stopColor={c.dawn}/><stop offset="1" stopColor="#fffcf4"/></radialGradient>
    </defs>
    <g clipPath="url(#horizon-clip)">
      <g transform={`translate(${lerp(630, 432, descend)} ${345 + descend * 410}) scale(1.5)`}><Moon id="morning-moon"/></g>
    </g>
    <rect width="1920" height="1080" fill="url(#daybreak)" opacity={sunrise}/>
    <path d={`M${960 - 880 * ramp(t, 1.4, 4.0)} 720H${960 + 880 * ramp(t, 1.4, 4.0)}`} stroke={c.gold} strokeWidth="2" opacity={1 - unfold}/>
    <circle cx="960" cy={lerp(780, 490, sunrise)} r={lerp(32, 104, sunrise)} fill="#fdbf11" opacity={sunrise * (1 - ramp(t, 4.6, 6.2))}/>
    <g opacity={ramp(t, 3.9, 4.7) * (1 - ramp(t, 6.0, 7.3))} transform={`translate(960 580) rotate(${-50 + unfold * 50})`}>
      {brandColors.slice(0, 5).map((v, i) => <path key={v} d={`M-${130 + i * 33} 0 A${130 + i * 33} ${130 + i * 33} 0 0 1 ${130 + i * 33} 0`}
        fill="none" stroke={v} strokeWidth="24" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - unfold}/>) }
    </g>
    <g opacity={ramp(t, 6.1, 7.1)}><Logo frame={Math.max(0, (t - 6.05) * 30)} starts={[0, 16, 29]} background={false}/></g>
    <text x="960" y="931" textAnchor="middle" fontFamily="Fredoka" fontSize="39" fill="#004f4f" opacity={ramp(t, 7.7, 8.8)}>Guten Morgen, Lundenburg!</text>
  </>;
}

function ProgrammeMotif({ block, t }: { block: ProgrammeBlock; t: number }) {
  const motif = programmeBlocks[block].motif, p = ramp(t, .1, 1.7);
  return <g transform="translate(1490 505)" fill="none" stroke={c.gold} opacity=".6">
    {motif === 'orbit' && [0, 1, 2].map(i => <ellipse key={i} rx={170 + i * 40} ry={60 + i * 18} transform={`rotate(${-40 + i * 50 + (1 - p) * 40})`} strokeWidth="1.5" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - p}/>) }
    {motif === 'landscape' && [0, 1, 2, 3, 4].map(i => <path key={i} d={`M-320 ${i * 42}Q-130 ${-180 + i * 60} 20 ${i * 32}T380 ${-50 + i * 35}`}
      strokeWidth="1.5" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - p}/>) }
    {motif === 'horizon' && [0, 1, 2].map(i => <path key={i} d={`M-${220 * p} ${i * 50}H${220 * p}`} strokeWidth="1.5"/>) }
    {motif === 'signal' && [0, 1, 2, 3, 4, 5, 6].map(i => <path key={i} d={`M${-210 + i * 62} 145V${145 - p * (80 + ((i * 83) % 180))}`} strokeWidth="3"/>) }
  </g>;
}

function Bumper({ t, block, outro }: { t: number; block: ProgrammeBlock; outro: boolean }) {
  const p = ramp(t, .2, 1.25), b = programmeBlocks[block];
  return <>
    <NightField t={t}/><ProgrammeMotif block={block} t={t}/>
    <g transform="translate(140 135) scale(.53)"><NachtMark id="bumper"/></g>
    <g transform={`translate(${(1 - p) * -32} 0)`} opacity={p}>
      <text x="145" y="371" fontFamily={nacht.fonts.sans} fontSize="23" letterSpacing="6" fill={c.gold}>{outro ? 'LUNDENBURG NACHT' : 'JETZT'}</text>
      <text x="140" y="493" fontFamily={nacht.fonts.serif} fontSize={block === 'geschichte' ? 66 : 84} fill={c.ivory}>{outro ? 'Die Nacht geht weiter.' : b.title}</text>
      <path d={`M145 549H${145 + 740 * ramp(t, .5, 1.7)}`} stroke={c.gold} strokeWidth="2"/>
      <text x="145" y="614" fontFamily={nacht.fonts.sans} fontSize="29" fill={c.ivory} opacity=".75">{outro ? 'Mehr sehen. Weiterdenken.' : b.subtitle}</text>
    </g>
    <text x="145" y="929" fontFamily={nacht.fonts.sans} fontSize="22" letterSpacing="4" fill={c.gold} opacity={p}>LN · LUNDENBURG NACHT</text>
  </>;
}

export function BrandScene({ film, frame, fps = 30, block = 'heimat' }: { film: BrandFilm; frame: number; fps?: number; block?: ProgrammeBlock }) {
  const t = Math.max(0, frame / fps);
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
    {film === 'day-continuity' ? <Logo frame={999}/> : film === 'evening' ? <Evening t={t}/> : film === 'morning' ? <Morning t={t}/> : film === 'intro' || film === 'outro' ? <Bumper t={t} block={block} outro={film === 'outro'}/> : film === 'continuity' ? <>
      <NightField t={30 / (2 * Math.PI) * Math.sin(t * 2 * Math.PI / 30)}/><Lockup t={10}/>
      <text x="960" y="850" textAnchor="middle" fontFamily={nacht.fonts.serif} fontSize="35" fill={c.gold}>Zeit zum Weitersehen.</text>
    </> : <>
      <NightField t={t}/>
      <g opacity={1 - ramp(t, 1.8, 3.2)} transform="translate(960 485)"><circle r={200 - 90 * ramp(t, 0, 2)} fill="none" stroke={c.gold} strokeWidth="2" pathLength="1" strokeDasharray=".7 .3" transform={`rotate(${-80 + 150 * ramp(t, 0, 2.6)})`}/></g>
      <Lockup t={t} start={1.4}/>
    </>}
  </svg>;
}
