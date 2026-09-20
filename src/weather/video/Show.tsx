import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { presenters, presenter } from '../characters.js';
import { project, type RegionMap } from '../geography.js';
import type { Episode, Period } from '../model.js';
import { Character } from './Character.js';
import { WeatherIcon } from './WeatherIcon.js';

export interface ShowProps extends Record<string, unknown> { episode: Episode; map: RegionMap }
const periodLabels: Record<Period, string> = { current: 'JETZT', afternoon: 'NACHMITTAG', evening: 'ABEND', tomorrow: 'MORGEN' };
const MapLines = React.memo(function MapLines({ map }: { map: RegionMap }) {
  return <>{map.features.map((feature, i) => <path key={i} d={feature.points.map(([lon, lat], j) => `${j ? 'L' : 'M'}${project(lon, lat).map(n => n.toFixed(1)).join(' ')}`).join('')} fill="none" stroke={feature.kind === 'rail' ? '#869087' : '#8ebcc4'} strokeWidth={feature.kind === 'rail' ? 2 : 6} strokeDasharray={feature.kind === 'rail' ? '6 3' : undefined} strokeLinecap="round"/>)}</>;
});
export function WeatherShow({ episode, map }: ShowProps) {
  const frame = useCurrentFrame();
  const beat = episode.beats.find(b => frame >= b.from && frame < b.from + b.frames) ?? [...episode.beats].reverse().find(b => frame >= b.from) ?? episode.beats[0]!;
  const intro = frame < 3 * episode.fps;
  const outro = frame > episode.durationInFrames - 3 * episode.fps;
  const active = presenter(beat.presenter);
  const fact = episode.forecast.cities[active.id].find(f => f.period === beat.period) ?? episode.forecast.cities[active.id][0]!;
  const seconds = (frame - beat.from) / episode.fps;
  const mouth = beat.asset.cues.find(c => seconds >= c.start && seconds < c.end)?.value ?? 'rest';
  const point = project(active.longitude, active.latitude);
  const pointing = ['context', 'condition', 'temperature', 'handoff'].includes(beat.purpose);
  const date = new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'long', timeZone: 'Europe/Prague' }).format(new Date(episode.broadcastAt));
  return <AbsoluteFill style={{ background: '#e9eddf', fontFamily: 'DejaVu Sans, sans-serif' }}>
    <svg viewBox="0 0 1920 1080" width="100%" height="100%">
      <defs><linearGradient id="wall" x2="0" y2="1"><stop stopColor={episode.edition === 'evening' ? '#c3d7d1' : '#eff2e3'}/><stop offset="1" stopColor="#d9e5d7"/></linearGradient><clipPath id="map-clip"><rect width="1000" height="850" rx="28"/></clipPath></defs>
      <rect width="1920" height="1080" fill="url(#wall)"/>
      <circle cx="160" cy="420" r="375" fill="#d2dfce" opacity=".6"/>
      <path d="M0 905Q960 865 1920 915V1080H0" fill="#c5d1be"/>
      <path d="M0 922Q960 890 1920 932" fill="none" stroke="#f5f3e5" strokeWidth="5"/>
      <rect x="90" y="64" width="94" height="53" rx="17" fill="#31594e"/><text x="137" y="101" textAnchor="middle" fill="#fff5d9" fontWeight="bold" fontSize="29">LKP</text>
      <text x="205" y="104" fill="#31594e" fontSize="39" fontWeight="bold">Wetterfreunde</text>
      <text x="1778" y="103" textAnchor="end" fill="#526d60" fontSize="25">{date} · {episode.edition === 'morning' ? 'Guten Morgen' : episode.edition === 'afternoon' ? 'Guten Nachmittag' : 'Guten Abend'}</text>
      <rect x="728" y="160" width="1088" height="785" rx="43" fill="#77958a" opacity=".25"/>
      <rect x="716" y="148" width="1088" height="785" rx="43" fill="#fff9e9" stroke="#748f7d" strokeWidth="4"/>
      <svg x="751" y="174" width="1020" height="728" viewBox="0 0 1000 850" preserveAspectRatio="none">
        <g clipPath="url(#map-clip)"><rect width="1000" height="850" fill="#e5ebd5"/>
          <path d="M0 0H260Q340 140 190 280T0 600Z" fill="#d5e1c5"/><path d="M1000 170Q820 260 903 440T1000 680Z" fill="#d4e0c7"/>
          <MapLines map={map}/>
          {presenters.map(p => {
            const [x, y] = project(p.longitude, p.latitude);
            const selected = p.id === active.id;
            const shown = selected ? fact : episode.forecast.cities[p.id][0]!;
            const pop = selected && beat.purpose === 'temperature' ? 1 + Math.sin(Math.min(Math.max(0, seconds) * 4, Math.PI)) * 0.045 : 1;
            return <g key={p.id} transform={`translate(${x} ${y})`}>
              {selected && <circle r={20 + Math.sin(frame / 15) * 3} fill="#f0c671" opacity=".5"/>}
              <circle r="8" fill={selected ? '#31594e' : '#789482'} stroke="#fff9e9" strokeWidth="4"/>
              <g transform={`translate(0 ${y < 180 ? 95 : -91}) scale(${pop})`}>
                <rect x="-117" y="-63" width="234" height="137" rx="23" fill={selected ? '#fff9e9' : '#f6f7ed'} stroke={selected ? '#426b59' : '#a7b99e'} strokeWidth={selected ? 4 : 2}/>
                <text y="-34" textAnchor="middle" fontSize="27" fontWeight="bold" fill="#284c42">{p.city}</text>
                <g transform="translate(-61 9) scale(.66)"><WeatherIcon state={shown.state} frame={selected ? frame : 0}/></g>
                <text x="28" y="25" textAnchor="middle" fill="#31594e" fontSize="43" fontWeight="bold">{shown.temperatureC}°</text>
                <text y="59" textAnchor="middle" fontSize="15" letterSpacing="2" fill="#667c68">{periodLabels[shown.period]}</text>
              </g>
            </g>;
          })}
        </g>
      </svg>
      <text x="1773" y="920" textAnchor="end" fill="#66745f" fontSize="14">© OpenStreetMap contributors · ODbL</text>
      <ellipse cx="370" cy="839" rx="180" ry="24" fill="#526a55" opacity=".13"/>
      <g transform="translate(380 490) scale(1.18)"><Character id={active.id} frame={frame} mouth={mouth} state={fact.state} pointing={pointing} target={[(751 + point[0] * 1.02 - 380) / 1.18, (174 + point[1] * .856 - 490) / 1.18]}/></g>
      <rect x="149" y="874" width="433" height="99" rx="24" fill="#fff9e9"/>
      <circle cx="193" cy="923" r="15" fill={active.color}/><text x="226" y="918" fontSize="34" fontWeight="bold" fill="#31594e">{active.name}</text><text x="226" y="951" fontSize="21" fill="#667c68">{active.city} · {periodLabels[fact.period]}</text>
      <text x="960" y="1014" textAnchor="middle" fill="#53705e" fontSize="21" letterSpacing="3">VIER STÄDTE. VIER FREUNDE. UNSER WETTER.</text>
      {episode.preview && <text x="1810" y="1050" textAnchor="end" fill="#825f55" fontSize="20">VORSCHAU · {episode.forecast.provider}</text>}
      {(intro || outro) && <g opacity={intro ? Math.min(1, Math.max(0, (3 * episode.fps - frame) / 15)) : Math.min(1, (frame - episode.durationInFrames + 3 * episode.fps) / 15)}>
        <rect width="1920" height="1080" fill="#e9eddf"/>
        <text x="960" y="193" textAnchor="middle" fontSize="38" letterSpacing="8" fill="#64856b">LUNDENBURG KIDS PREMIUM</text>
        <text x="960" y="310" textAnchor="middle" fontSize="100" fontWeight="bold" fill="#31594e">{outro ? 'Bis bald, Wetterfreunde!' : 'Die Wetterfreunde'}</text>
        <text x="960" y="380" textAnchor="middle" fontSize="29" fill="#64856b">Lundenburg · Wien · Brno · Bratislava</text>
        {presenters.map((p, i) => <g key={p.id} transform={`translate(${350 + i * 405} 650) scale(.73)`}><Character id={p.id} frame={frame + i * 13} state={episode.forecast.cities[p.id][0]!.state} pointing={false}/><text y="365" textAnchor="middle" fontSize="33" fill="#31594e">{p.name}</text></g>)}
      </g>}
    </svg>
    {episode.beats.filter(b => b.asset.audio).map(b => <Sequence key={b.id} from={b.from} durationInFrames={b.frames}><Audio src={staticFile(b.asset.audio)}/></Sequence>)}
    <Sequence durationInFrames={episode.fps * 3}><Audio src={staticFile('sting.wav')} volume={0.30}/></Sequence>
    <Sequence from={episode.durationInFrames - episode.fps * 3} durationInFrames={episode.fps * 3}><Audio src={staticFile('sting.wav')} volume={0.24}/></Sequence>
  </AbsoluteFill>;
}
