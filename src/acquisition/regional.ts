import { normalize } from './model.js';

const near = ['weinviertel', 'marchfeld', 'thayatal', 'march thaya', 'marchauen', 'thayaauen', 'bernhardsthal', 'hohenau', 'poysdorf', 'mistelbach', 'schrattenberg', 'laa an der thaya', 'breclav', 'lundenburg'];
const secondary = ['waldviertel', 'wachau', 'donau', 'niederosterreich', 'niederoesterreich', 'lower austria'];
export function regionalRelevance(text: string): number {
  const n = ` ${normalize(text)} `;
  if (near.some(place => n.includes(` ${place} `))) return 100;
  if (/\b(?:tschechisch|osterreichisch|oesterreichisch|czech|austrian)\w*\b/.test(n) && /grenze|border|nachbarn|nachbar/.test(n)) return 85;
  return secondary.some(place => n.includes(` ${place} `)) ? 50 : 0;
}
