import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Atlas } from './video/Atlas.js';
import type { RegionMap } from './geography.js';

export function prepareAtlas(map: RegionMap): string {
  const borders = JSON.parse(fs.readFileSync('assets/weather/borders.json','utf8')) as { lines: number[][][] };
  const svg = renderToStaticMarkup(<Atlas map={map} borders={borders.lines}/>);
  const hash = crypto.createHash('sha256').update(svg).digest('hex').slice(0,20);
  const relative = `maps/atlas-${hash}.png`;
  const output = path.resolve('runtime/weather/public', relative);
  if (!fs.existsSync(output)) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const source = output.replace('.png','.svg');
    fs.writeFileSync(source, svg);
    // Rasterize once at twice on-screen resolution; 9,551 geographic paths no
    // longer need to be traversed and painted for every video frame.
    execFileSync('ffmpeg',['-v','error','-nostdin','-y','-i',source,'-frames:v','1','-threads','1','-update','1',`${output}.tmp.png`],{ timeout: 25_000 });
    fs.renameSync(`${output}.tmp.png`,output);
  }
  return relative;
}
