import React from 'react';
import { channelIconPaths, brandColors } from '../../characters/brand.js';

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 1 - (1 - clamp(x)) ** 3;
const back = (x: number) => { const t = clamp(x) - 1; return 1 + 2.70158 * t ** 3 + 1.70158 * t ** 2; };

export function Logo({ frame = 999, starts = [0, 42, 66], fact }: { frame?: number; starts?: number[]; fact?: string }) {
  const a = ease((frame - starts[0]!) / 15), b = back((frame - starts[1]!) / 14), c = back((frame - starts[2]!) / 18);
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="100%" height="100%" style={{ fontFamily: 'Fredoka, sans-serif' }}>
    <rect width="1920" height="1080" fill="#fffcf4"/>
    <circle cx="83" cy="1050" r="260" fill="#fdbf11" opacity=".06"/>
    <circle cx="1845" cy="-70" r="300" fill="#02aafd" opacity=".045"/>
    <g transform={`translate(${240 - (1 - a) * 1050} 237) rotate(${(1 - a) * -150} 260 275)`} opacity={a}>
      <g transform="scale(.418)">{channelIconPaths.map((p, i) => <path key={i} d={p.d} fill={p.fill} fillRule="evenodd"/>)}</g>
    </g>
    <g opacity={a} transform={`translate(${(1 - a) * -120} 0)`}>
      <text x="864" y="378" fill="#004f4f" fontWeight="500" fontSize="70" letterSpacing="2">Lundenburg</text>
    </g>
    <g transform={`translate(${(1 - b) * 1200} ${Math.sin(clamp((frame - starts[1]!) / 21) * Math.PI) * -18})`} opacity={clamp(b)}>
      {'KIDS'.split('').map((l, i) => <g key={l} transform={`translate(${[835,1037,1143,1356][i]} ${[626,616,624,615][i]}) rotate(${[-5,3,-3,5][i]})`}>
        <text y="9" fontWeight="700" fontSize="274" fill="#004f4f" opacity=".09">{l}</text>
        <text fontWeight="700" fontSize="274" fill={[brandColors[4], brandColors[3], brandColors[2], brandColors[0]][i]} stroke="#fffcf4" strokeWidth="7" paintOrder="stroke">{l}</text>
      </g>)}
    </g>
    <g opacity={clamp(c)} transform={`translate(${-(1 - c) * 1680} 0)`}>
      <path d="M868 693h575l-22 37 22 37H868Z" fill="#004f4f"/>
      <text x="1153" y="744" textAnchor="middle" fontWeight="450" fontSize="41" letterSpacing="9" fill="#fffcf4">PREMIUM</text>
      <g transform="translate(1604 457) rotate(8)"><rect x="-65" y="-65" width="130" height="130" rx="39" fill="#004f4f" opacity=".08" transform="translate(0 8)"/><rect x="-65" y="-65" width="130" height="130" rx="39" fill="#fd6f04"/>
        <path d="M-29 0H29M0-29V29" stroke="#fffcf4" strokeWidth="20" strokeLinecap="round"/>
      </g>
    </g>
    {fact && <text x="960" y="919" textAnchor="middle" fontSize="35" fill="#004f4f">{fact}</text>}
  </svg>;
}
