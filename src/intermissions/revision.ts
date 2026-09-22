import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Film } from './model.js';

export function filmRevision(film: Film): string {
  const hash=createHash('sha256').update('lkp-intermissions-1080p30-v2');
  const files:string[]=[];
  const walk=(directory:string)=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else files.push(file);}};
  walk('src/characters');walk('src/intermissions/video');
  files.push('src/intermissions/audio.ts','assets/weather/fonts/Fredoka.ttf');
  for(const file of files.sort())hash.update(file).update(fs.readFileSync(file));
  return hash.update(JSON.stringify(film)).digest('hex');
}
export function isCurrentRender(film:Film,root='runtime/intermissions'):boolean {
  const media=path.join(root,'videos',`${film.skit.id}.mp4`), metadata=media.replace(/\.mp4$/,'.json');
  if(!fs.existsSync(media)||!fs.existsSync(metadata))return false;
  const meta=JSON.parse(fs.readFileSync(metadata,'utf8'));
  return !meta.preview&&meta.renderRevision===filmRevision(film);
}
