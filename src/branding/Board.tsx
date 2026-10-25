import React from 'react';
import { NachtMark } from './Mark.js';
import { NightField } from './Scene.js';
import { nacht } from './identity.js';

/** Review artifact only; never becomes an on-air programme. */
export function BrandBoard() {
  const c = nacht.colors;
  return <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1440" viewBox="0 0 1920 1440">
    <rect width="1920" height="1440" fill={c.ink}/>
    <g fontFamily="DejaVu Sans" fill={c.ivory}>
      <text x="100" y="86" fontSize="20" letterSpacing="6" fill={c.gold}>LUNDENBURG · NACH EINBRUCH DER DUNKELHEIT</text>
      <path d="M100 120H1820" stroke={c.gold} opacity=".35"/>
      <g transform="translate(150 243) scale(1.9)"><NachtMark id="board"/></g>
      <text x="570" y="678" textAnchor="middle" fontSize="29" letterSpacing="8">LUNDENBURG NACHT</text>
      <path d="M166 614H976" stroke={c.gold} strokeWidth="2"/>
      <text x="1180" y="276" fontSize="18" letterSpacing="5" fill={c.gold}>DIE HALTUNG</text>
      <g fontFamily="DejaVu Serif" fontSize="57"><text x="1176" y="363">Wach bleiben.</text><text x="1176" y="438">Weitersehen.</text></g>
      <g fontSize="24" fill={c.ivory} opacity=".75"><text x="1180" y="522">Neugierig, ruhig und weltoffen.</text><text x="1180" y="568">Eine Bühne für Geschichten,</text><text x="1180" y="607">die am Abend Raum bekommen.</text></g>
      <path d="M100 760H1820" stroke={c.gold} opacity=".35"/>
      <text x="100" y="819" fontSize="18" letterSpacing="4" fill={c.gold}>01 / FARBE</text>
      {Object.entries({ 'Tintenblau': c.ink, 'Mitternacht': c.midnight, 'Champagner': c.gold, 'Elfenbein': c.ivory }).map(([label, fill], i) => <g key={label} transform={`translate(${100 + i * 255} 852)`}>
        <rect width="228" height="100" fill={fill} stroke={c.ivory} strokeOpacity=".2"/>
        <text y="137" fontSize="20">{label}</text><text y="168" fontSize="17" fill={c.gold}>{fill.toUpperCase()}</text>
      </g>)}
      <text x="1180" y="819" fontSize="18" letterSpacing="4" fill={c.gold}>02 / DAS SENDERSIGNET</text>
      <g transform="translate(1180 852)">
        <rect width="640" height="212" fill={c.horizon}/>
        <path d="M0 168Q170 80 340 150T640 130V212H0Z" fill={c.ink} opacity=".6"/>
        <g transform="translate(28 25) scale(.42)" opacity=".88"><NachtMark id="bug"/></g>
        <text x="28" y="183" fontSize="17">Klein. Statisch. Ohne Animation im Programm.</text>
      </g>
      <path d="M100 1110H1820" stroke={c.gold} opacity=".35"/>
      <text x="100" y="1170" fontSize="18" letterSpacing="4" fill={c.gold}>03 / SCHRIFT UND SPRACHE</text>
      <text x="100" y="1255" fontFamily="DejaVu Serif" fontSize="54">Unsere Heimat</text>
      <text x="102" y="1314" fontSize="25" opacity=".75">Landschaften. Menschen. Geschichten.</text>
      <text x="1180" y="1170" fontSize="18" letterSpacing="4" fill={c.gold}>04 / BEWEGUNG</text>
      <text x="1180" y="1235" fontSize="26">Regenbogen → Orbit → Mond</text>
      <text x="1180" y="1281" fontSize="26">Mond → Horizont → Morgen</text>
      <text x="1180" y="1327" fontSize="20" opacity=".65">Fließend. Räumlich. Mit Zeit zum Lesen.</text>
      <text x="100" y="1400" fontSize="16" letterSpacing="3" fill={c.gold}>LN / IDENTITÄT 01</text>
    </g>
  </svg>;
}
