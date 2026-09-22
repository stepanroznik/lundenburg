import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { catalogue } from './catalogue.js';
import { readFilms, outputRoot } from './render.js';
import { isCurrentRender, filmRevision } from './revision.js';
import type { PublishedLibrary, RotationClip } from './rotation.js';

export function publishLibrary() {
  const films=readFilms([]);
  if(films.length!==catalogue.length)throw new Error('The full set must be prepared before publication');
  const clips:RotationClip[]=[];
  const hash=createHash('sha256');
  for(const film of films){
    if(film.preview||!isCurrentRender(film))throw new Error(`Final render missing or outdated: ${film.skit.id}. Run intermissions:render first.`);
    const mediaPath=path.join(outputRoot,'videos',`${film.skit.id}.mp4`);
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',mediaPath],{encoding:'utf8'}));
    const video=probe.streams.find((s:{codec_type:string})=>s.codec_type==='video');
    const audio=probe.streams.find((s:{codec_type:string})=>s.codec_type==='audio');
    const duration=Number(probe.format.duration);
    if(!video||video.width!==1920||video.height!==1080||video.r_frame_rate!=='30/1'||video.codec_name!=='h264'||!audio||audio.codec_name!=='aac'||audio.channels!==2||Number(audio.sample_rate)!==48000||!Number.isFinite(duration)||Math.abs(duration-film.durationInFrames/30)>.15)throw new Error(`Invalid final media profile: ${film.skit.id}`);
    clips.push({id:film.skit.id,title:film.skit.title,kind:film.skit.kind,...(film.skit.season?{season:film.skit.season}:{}),mediaPath,durationMs:Math.round(duration*1000),languages:[...new Set(film.skit.lines.map(l=>l.language))],synopsis:film.skit.synopsis});
    hash.update(filmRevision(film));
  }
  const manifest:PublishedLibrary={version:1,revision:hash.digest('hex'),clips};
  const output=path.join(outputRoot,'published.json');
  fs.writeFileSync(`${output}.tmp`,JSON.stringify(manifest,null,2));fs.renameSync(`${output}.tmp`,output);
  console.log(`Published ${clips.length} validated clips: ${output}`);
}
