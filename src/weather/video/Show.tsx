import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame, interpolateColors } from 'remotion';
import { presenters, presenter } from '../characters.js';
import { project } from '../geography.js';
import { forecastDate, periodTheme } from '../display.js';
import type { Episode } from '../model.js';
import { Character } from './Character.js';
import { WeatherIcon } from './WeatherIcon.js';
import { Landmark } from './Atlas.js';

function Cloud({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}><path d="M-72 23C-110 22-111-24-75-28C-67-72-11-73 3-45C36-75 76-43 73-16C116-10 110 27 73 28Z" fill="#fffef8" stroke="#c8e6dc" strokeWidth="3"/></g>;
}
function HappySun({ x, y, frame }: { x: number; y: number; frame: number }) {
  return <g transform={`translate(${x} ${y})`}><g transform={`rotate(${Math.sin(frame/60)*4})`} stroke="#fdbf11" strokeWidth="9" strokeLinecap="round">{Array.from({length:8},(_,i)=><path key={i} d="M0-56v-16" transform={`rotate(${i*45})`}/>)}</g><circle r="43" fill="#ffda59"/><path d="M-15-4v5m30-5v5" stroke="#004f4f" strokeWidth="6" strokeLinecap="round"/><path d="M-13 16q13 14 26 0" stroke="#b88327" strokeWidth="3" fill="none"/><circle cx="-26" cy="12" r="6" fill="#f6b662"/><circle cx="26" cy="12" r="6" fill="#f6b662"/></g>;
}
export interface ShowProps extends Record<string, unknown> { episode: Episode; atlas: string }
export function WeatherShow({ episode, atlas }: ShowProps) {
  const frame = useCurrentFrame();
  let index = 0;
  for (let i = 0; i < episode.beats.length; i++) { if (episode.beats[i]!.from <= frame) index = i; else break; }
  const beat = episode.beats[index]!;
  const intro = frame < 3 * episode.fps;
  const outro = frame >= episode.beats.at(-1)!.from + episode.beats.at(-1)!.frames + 9;
  const active = presenter(beat.presenter);
  const fact = episode.forecast.cities[active.id].find(f => f.period === beat.period) ?? episode.forecast.cities[active.id][0]!;
  const theme = periodTheme[fact.period];
  const previousTheme = periodTheme[episode.beats[Math.max(0, index - 1)]!.period];
  const transition = Math.min(1, Math.max(0, (frame - beat.from) / 12));
  const border = interpolateColors(transition, [0, 1], [previousTheme.color, theme.color]);
  const seconds = (frame - beat.from) / episode.fps;
  const mouth = beat.asset.cues.find(c => seconds >= c.start && seconds < c.end)?.value ?? 'rest';
  const point = project(active.longitude, active.latitude);
  const pointing = ['context', 'condition', 'temperature', 'handoff'].includes(beat.purpose);
  return <AbsoluteFill style={{ background: '#f9fbf4', fontFamily: 'Fredoka, DejaVu Sans, sans-serif' }}>
    <svg viewBox="0 0 1920 1080" width="100%" height="100%">
      <defs>
        <clipPath id="panel-clip"><rect x="678" y="140" width="1148" height="856" rx="24"/></clipPath>
        <clipPath id="map-clip"><rect width="1100" height="760" rx="20"/></clipPath>
      </defs>
      {(!intro || frame > 3 * episode.fps - 15) && !outro && <>
      <rect width="1920" height="1080" fill="#eff8f2"/>
      <path d="M0 0H1920V115Q1380 25 860 127T0 87Z" fill="#cfeee9"/>
      <path d="M0 71Q243 15 431 92" fill="none" stroke="#004f4f" strokeWidth="5"/>
      {[0,1,2,3,4].map(i=><path key={i} d={`M${40+i*70} ${56-i*2}l15 30 17-34Z`} fill={['#fdbf11','#02aafd','#79c718','#fd6f04','#fb1143'][i]}/>)}
      <Cloud x={141} y={247} scale={1.1}/><HappySun x={478} y={235} frame={frame}/>
      <path d="M0 848Q143 774 294 837T660 821V1080H0Z" fill="#d6e9ce"/>
      <path d="M0 965Q290 895 565 975T1920 1010V1080H0" fill="#c5dfba"/>
      <path d="M0 1070Q175 970 410 1040" fill="none" stroke="#8db873" strokeWidth="4"/>
      <g transform="translate(47 928)"><path d="M0 0v66m0-13q-38 1-37-31 34 1 37 31m0-19q28 3 28-26-25 3-28 26" fill="#79c718" stroke="#668d53" strokeWidth="3"/><g fill="#fd6f04">{[0,1,2,3,4].map(i=><ellipse key={i} cy="-17" rx="10" ry="17" transform={`rotate(${i*72})`}/>)}</g><circle r="11" fill="#fdbf11"/></g>
      <rect x="688" y="150" width="1152" height="858" rx="28" fill="#004f4f" opacity=".10"/>
      <g clipPath="url(#panel-clip)">
        <rect x="678" y="140" width="1148" height="856" fill="#fff"/>
        <rect x="678" y="140" width="1148" height="90" fill={theme.tint}/>
        <path d="M678 140H1170L1190 160 1179 219H693L678 200Z" fill={border}/>
      </g>
      <rect x="678" y="140" width="1148" height="856" rx="24" fill="none" stroke={border} strokeWidth="5"/>
      <circle cx="1788" cy="162" r="8" fill="#fdbf11"/>
      <text x="715" y="201" fill="white" fontWeight="bold" fontSize={fact.period === 'afternoon' ? 43 : 53}>{theme.label}</text>
      <text x="1760" y="194" textAnchor="end" fill="#004f4f" fontSize="24">{forecastDate(episode.broadcastAt, fact.period)}</text>
      <svg x="696" y="244" width="1112" height="733" viewBox="0 0 1100 760" preserveAspectRatio="none">
        <g clipPath="url(#map-clip)">
          <foreignObject width="1100" height="760"><Img src={staticFile(atlas)} style={{ width: 1100, height: 760 }}/></foreignObject>
          {presenters.map(p => {
            const [x, y] = project(p.longitude, p.latitude);
            const selected = p.id === active.id;
            // The large period heading applies to the ENTIRE map, never a mix
            // of tomorrow for one city and current conditions for the others.
            const shown = episode.forecast.cities[p.id].find(f => f.period === fact.period) ?? episode.forecast.cities[p.id][0]!;
            const pop = selected && beat.purpose === 'temperature' ? 1 + Math.sin(Math.min(Math.max(0, seconds) * 4, Math.PI)) * .035 : 1;
            return <g key={p.id} transform={`translate(${x} ${y})`}>
              {selected && <ellipse cy="14" rx={66+Math.sin(frame/18)*3} ry="22" fill={theme.color} opacity=".15"/>}
              <g transform="translate(0 11) scale(.78)"><Landmark city={p.id}/></g>
              <g transform={`translate(0 -130) scale(${pop})`}>
                <path d="M-108-46H98L110-34V45L98 57H-108V-46Z" fill={selected ? theme.color : '#fffdf3'} stroke={selected ? theme.color : '#8db39c'} strokeWidth={selected ? 3 : 1.5}/>
                <text y="-17" textAnchor="middle" fontSize="23" fontWeight="bold" fill={selected ? 'white' : '#004f4f'}>{p.city}</text>
                <g transform="translate(-49 18) scale(.59)"><WeatherIcon state={shown.state} frame={selected ? frame : 0}/></g>
                <text x="30" y="37" textAnchor="middle" fill={selected ? 'white' : '#004f4f'} fontSize="40" fontWeight="bold">{shown.temperatureC}°</text>
                <path d="M-6 57L0 65 6 57" fill={selected ? theme.color : '#8db39c'}/>
              </g>
            </g>;
          })}
        </g>
      </svg>
      <ellipse cx="330" cy="854" rx="169" ry="18" fill="#004f4f" opacity=".10"/>
      <g transform="translate(330 540) scale(1.08)"><Character id={active.id} frame={frame} mouth={mouth} state={fact.state} pointing={pointing} target={[(696 + point[0] * 1.01 - 330) / 1.08, (244 + point[1] * .964 - 540) / 1.08]}/></g>
      <path d="M139 897L540 887 562 962 151 977Z" fill="#ffe6a1" stroke="#debc72" strokeWidth="2"/>
      <circle cx="163" cy="912" r="7" fill="#fb1143"/>
      <text x="188" y="947" fontSize="37" fontWeight="600" fill="#004f4f">{active.name}</text>
      </>}
      {(intro || outro) && <g opacity={intro ? Math.min(1, Math.max(0, (3 * episode.fps - frame) / 15)) : Math.min(1, (frame - episode.beats.at(-1)!.from - episode.beats.at(-1)!.frames - 9) / 12)}>
        <rect width="1920" height="1080" fill="#e6f4ef"/>
        <path d="M0 873Q470 806 1010 934T1920 868V1080H0" fill="#cce4bd"/>
        <path d="M0 1000Q360 933 900 1025T1920 984V1080H0" fill="#b4d695"/>
        <Cloud x={220} y={197} scale={1.3}/><Cloud x={1690} y={359} scale={1.3}/>
        <HappySun x={1535} y={190} frame={frame}/>
        <path d="M428 332Q344 223 453 197Q492 96 610 162Q780 105 960 151Q1160 95 1280 163Q1420 112 1460 215Q1550 268 1474 339Q1390 389 1240 366H618Q489 388 428 332Z" fill="#fffdf1" stroke="#d3e5c5" strokeWidth="3"/>
        <text x="960" y="225" textAnchor="middle" fontSize="38" fontWeight="500" fill="#508174">{outro ? 'Bis bald, liebe' : 'Hier kommen die'}</text>
        <text x="960" y="315" textAnchor="middle" fontSize="100" fontWeight="600" fill="#004f4f">Wetterfreunde{outro ? '!' : ''}</text>
        <text x="960" y="397" textAnchor="middle" fontSize="27" fill="#34706a">{outro ? 'Lundenburg · Wien · Brno · Bratislava' : 'Vier Städte. Vier Freunde. Unser Wetter.'}</text>
        {intro && episode.preview && <text x="960" y="1060" textAnchor="middle" fill="#52796d" fontSize="17">{episode.forecast.provider.startsWith('fixture:') ? 'Gestaltungsprobe · Beispielwetter' : 'Gestaltungsprobe'}</text>}
        {presenters.map((p, i) => <g key={p.id} transform={`translate(${350 + i * 405} 590) scale(.74)`}><Character id={p.id} frame={frame + i * 13} state={episode.forecast.cities[p.id][0]!.state} pointing={false}/><text y="365" textAnchor="middle" fontSize="33" fill="#004f4f">{p.name}</text></g>)}
        {outro && <text x="960" y="920" textAnchor="middle" fill="#52796d" fontSize="18">Kartendaten © OpenStreetMap contributors · openstreetmap.org/copyright · Wetter: {episode.forecast.provider.startsWith('fixture:') ? 'Beispieldaten' : 'Open-Meteo'}</text>}
      </g>}
    </svg>
    {episode.beats.filter(b => b.asset.audio).map(b => <Sequence key={b.id} from={b.from} durationInFrames={b.frames}><Audio src={staticFile(b.asset.audio)}/></Sequence>)}
    <Sequence durationInFrames={episode.fps * 3}><Audio src={staticFile('sting.wav')} volume={0.30}/></Sequence>
    <Sequence from={episode.durationInFrames - episode.fps * 3} durationInFrames={episode.fps * 3}><Audio src={staticFile('sting.wav')} volume={0.24}/></Sequence>
  </AbsoluteFill>;
}
