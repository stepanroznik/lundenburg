import React from 'react';
import { project, type RegionMap } from '../geography.js';
import type { Presenter } from '../model.js';

// Landmarks use one illustration vocabulary: teal outlines, cream walls,
// angular roofs and small accents from the channel palette.
export function Landmark({ city }: { city: Presenter }) {
  return <g stroke="#004f4f" strokeWidth="2.4" strokeLinejoin="miter">
    <ellipse cy="15" rx="62" ry="12" fill="#adc996" stroke="none"/>
    {city === 'knurpsi' && <><path d="M-47 9v-39h90V9Z" fill="#f7eac9"/><path d="M-55-30l19-19h62l26 19Z" fill="#fd6f04"/><path d="M-10 9v-66H9V9Z" fill="#fff6dc"/><path d="M-16-57L0-85l15 28Z" fill="#004f4f"/><path d="M-5 9V-6Q0-14 5-6V9" fill="#004f4f"/><path d="M-35-20v10m16-10v10m40-10v10m15-10v10" strokeWidth="5"/><circle cy="-43" r="5" fill="#fdbf11"/><path d="M-45 22H44m-38-4v8m-20-8v8m-20-8v8m-20-8v8" stroke="#859385"/></>}
    {city === 'sisi' && <><path d="M-28 12v-42h62v42Z" fill="#f8efd3"/><path d="M-35-30L0-54l43 24Z" fill="#79c718"/><path d="M8 12v-68h20v68Z" fill="#fff5d9"/><path d="M5-56l13-41 15 41Z" fill="#004f4f"/><path d="M13-41v17m-34 12h18m8 0h18" stroke="#b2945c"/><circle cx="-51" cy="-12" r="24" fill="#eff7e0" stroke="#fd6f04"/><path d="M-51-36v48m-24-24h48m-41-17l34 34m0-34l-34 34M-51-12l-16 33m16-33l16 33" stroke="#bd8e52" strokeWidth="1.8"/>{[0,1,2,3,4,5,6,7].map(i => <rect key={i} x={-55+Math.cos(i*Math.PI/4)*24} y={-16+Math.sin(i*Math.PI/4)*24} width="8" height="8" fill="#fd6f04" stroke="none"/>)}</>}
    {city === 'schalinka' && <><path d="M-39 12v-42h76v42Z" fill="#f4e4bc"/><path d="M-22-30L0-53l23 23Z" fill="#fd6f04"/><path d="M-38 12v-64h20v64m35 0v-64h20v64" fill="#fff6dc"/><path d="M-43-52l15-42 15 42Zm55 0l15-42 15 42Z" fill="#004f4f"/><path d="M-31-30v20m56-20v20" strokeWidth="5"/><path d="M-9 12V-5Q0-22 9-5v17" fill="#004f4f"/><circle cy="-28" r="7" fill="#fdbf11"/></>}
    {city === 'haluschka' && <><path d="M-46 11v-45h91v45Z" fill="#fff4db"/><path d="M-48-34l18-15h61l16 15Z" fill="#fd6f04"/>{[-46,28].map(x => <g key={x}><path d={`M${x} 11v-65h18v65`} fill="#fff6dc"/><path d={`M${x-4}-54l13-20 13 20Z`} fill="#fb1143"/><path d={`M${x+9}-42v8`} strokeWidth="4"/></g>)}<path d="M-27-50v-15h14v16m28 0v-16h14v16" fill="#f8e6c3"/><path d="M-8 11V-2Q0-17 8-2v13" fill="#004f4f"/><path d="M-19-23v10m19-10v10m19-10v10" strokeWidth="4"/></>}
  </g>;
}
function Tree({ x, y, size, pine }: { x: number; y: number; size: number; pine: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`}><ellipse cy="10" rx="12" ry="4" fill="#669069" opacity=".2"/><path d="M0-10V11" stroke="#778464" strokeWidth="3"/>{pine ? <path d="M0-35L-14-8h7L-18 3H18L7-8h7Z" fill="#458e72"/> : <><path d="M0-32C-18-35-23-2-10 0C-4 10 18 2 16-12C21-23 8-37 0-32Z" fill="#79b652"/><path d="M0-22V2" stroke="#54834f" strokeWidth="2"/></>}</g>;
}
// Symbolic forest clusters and real settlement coordinates decorate the OSM
// geography; these illustrations are not a land-cover survey.
const forests = [[16.2,49.17,14], [16.78,49.31,18], [16.16,48.3,17], [16.98,48.61,17], [17.29,48.53,16], [16.53,48.95,10], [16.81,48.82,10]];
const villages = [[16.638,48.805,'Mikulov'], [16.803,48.801,'Lednice'], [16.576,48.571,'Mistelbach'], [17.021,48.436,'Malacky'], [17.132,48.849,'Hodonín']] as const;
const projectedLength = (points: [number, number][]) => points.slice(1).reduce((sum, point, i) => {
  const a = project(points[i]![0], points[i]![1]);
  const b = project(point[0], point[1]);
  return sum + Math.hypot(b[0] - a[0], b[1] - a[1]);
}, 0);

export function Atlas({ map, borders = [] }: { map: RegionMap; borders?: number[][][] }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 760" width="2200" height="1520">
    <defs><pattern id="fields" width="125" height="100" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)"><rect width="125" height="100" fill="#e7efd3"/><path d="M0 0H125V48H0Z" fill="#e1edc7"/><path d="M10 60H115m-105 8H115m-105 8H115m-105 8H115" stroke="#d2dfb8" strokeWidth="2"/></pattern></defs>
    <rect width="1100" height="760" fill="#edf3de"/>
    <path d="M0 60Q200 12 350 173T640 170T1100 125V760H0Z" fill="url(#fields)"/>
    <path d="M0 210Q170 120 220 280T390 530L290 760H0ZM870 0Q740 160 1010 285L1100 200V0Z" fill="#d5e7bd"/>
    <path d="M0 620Q160 560 195 680T420 760M760 760Q890 610 1100 650" stroke="#ccdfb0" strokeWidth="28" fill="none"/>
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">{map.features.filter(f=>f.kind==='river').map((f,i)=><path key={i} d={f.points.map(([x,y],j)=>`${j?'L':'M'}${project(x,y).map(n=>n.toFixed(1)).join(' ')}`).join('')} stroke="#80c9d5" strokeWidth="3.2"/>)}</g>
    <g fill="none">{map.features.filter(f=>f.kind==='rail').map((f,i)=>{
      const d=f.points.map(([x,y],j)=>`${j?'L':'M'}${project(x,y).map(n=>n.toFixed(1)).join(' ')}`).join('');
      const main = f.importance ? f.importance === 'main' : projectedLength(f.points) >= 18;
      const opacity = main ? .55 : .18;
      return <g key={i}><path d={d} stroke="#879384" strokeOpacity={opacity} strokeWidth={main ? 7 : 5} strokeDasharray="1.4 7"/><path d={d} stroke="#738477" strokeOpacity={opacity} strokeWidth={main ? 3.1 : 2.2}/><path d={d} stroke="#e7efd3" strokeOpacity={opacity} strokeWidth={main ? 1.35 : .9}/></g>;
    })}</g>
    <g fill="none" stroke="#004f4f" strokeWidth="9" opacity=".16" strokeLinecap="round" strokeLinejoin="round">{borders.map((line,i)=><path key={i} d={line.map((p,j)=>`${j?'L':'M'}${project(p[0]!,p[1]!).map(n=>n.toFixed(1)).join(' ')}`).join('')}/>)}</g>
    {forests.flatMap(([lon,lat,count],cluster)=>Array.from({length:count!},(_,i)=>{
      const [x,y]=project(lon!,lat!);const a=i*2.39996;const r=Math.sqrt(i)*15;
      return <Tree key={`${cluster}-${i}`} x={x+Math.cos(a)*r} y={y+Math.sin(a)*r*.65} size={.62+(i%4)*.11} pine={(i+cluster)%3===0}/>;
    }))}
    {villages.map(([lon,lat,name])=>{
      const [x,y]=project(lon,lat);
      return <g key={name} transform={`translate(${x} ${y})`}><path d="M-22 9h45" stroke="#d5caaa" strokeWidth="4"/>{[-16,0,15].map((dx,i)=><g key={dx} transform={`translate(${dx} ${i%2*5})`}><path d="M-6 6V-5H6V6Z" fill="#fff6df" stroke="#b7b9a0"/><path d="M-9-5L0-13 9-5Z" fill={i%2?'#dc9e66':'#aab77c'}/><path d="M-1 6V1H2V6" fill="#789486"/></g>)}<text y="30" textAnchor="middle" fill="#80947e" fontFamily="DejaVu Sans, sans-serif" fontSize="11">{name}</text></g>;
    })}
  </svg>;
}
