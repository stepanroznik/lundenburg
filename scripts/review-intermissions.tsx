// Fast geometry review: render the very same SVG scenes at explicit action
// beats, without encoding video or requesting speech. Full browser stills can
// additionally be generated with intermissions:stills -- --seconds 1,2,3.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SilentScene} from '../src/intermissions/video/Silent.js';
import {VoicedScene} from '../src/intermissions/video/Voiced.js';
import {Logo} from '../src/intermissions/video/Logo.js';
import type {Film} from '../src/intermissions/model.js';

const root='runtime/intermissions/review';fs.mkdirSync(root,{recursive:true});
const moments:Record<string,number[]>={
  puddles:[.5,1.65,2.4,3.4,3.92,4.3,4.65,6],flowers:[.3,1.4,2.45,3.65,4.8,6.2,7.2,8.8],
  pool:[.5,1.5,2.5,3.5,4.5,5.5,6.8,8.5],beachball:[.5,1.25,2.1,2.85,3.5,5.3,6.4,7.5],
  leaves:[.5,2.5,3.2,3.85,4.3,5.8,6.5,7.4],kite:[.5,1.5,2.7,3.8,4.8,5.4,6.5,8],
  snowballs:[.5,1.3,1.53,2.15,2.65,3.4,4.15,6],snowman:[.2,1.1,2.2,3.65,4.5,5.8,8.4,9.6],
};
for(const file of fs.readdirSync('runtime/intermissions/manifests').filter(f=>f.endsWith('.json')&&!f.includes('.preview'))){
  const film=JSON.parse(fs.readFileSync(path.join('runtime/intermissions/manifests',file),'utf8')) as Film;
  if(process.argv.length>2&&!process.argv.slice(2).some(id=>film.skit.id.startsWith(id)))continue;
  const end=(i:number)=>(film.cues[i]!.from+film.cues[i]!.frames)/30;
  let seconds=moments[film.skit.scene]??[.1,.5,1,2,3,4,5,6];
  if(film.skit.scene==='soap') seconds=[.5,2,4,end(1),end(2)-.2,end(2)+.2,end(2)+.8,end(2)+1.3];
  if(film.skit.scene==='dam'){
    const permit=film.cues.findIndex(c=>c.text==='Und eine Baugenehmigung?'),p=film.cues[permit]!.from/30;
    seconds=[.5,film.cues[2]!.from/30+1,film.cues[5]!.from/30+1,film.cues[7]!.from/30+1,p-.1,p+.25,p+1.1,end(permit)+.4];
  }
  if(film.skit.scene==='quiet')seconds=[1,end(1),end(1)+1,end(1)+3,end(1)+6,end(1)+7.3,film.cues[2]!.from/30+.5,film.cues[4]!.from/30+.5];
  for(const [i,t] of seconds.entries()){
    const frame=Math.round(t*30);
    const scene=film.skit.kind==='ident'?<Logo frame={frame} starts={film.cues.map(c=>c.from)}/>:<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" style={{fontFamily:'DejaVu Sans'}}>{film.skit.kind==='silent'?<SilentScene film={film} frame={frame}/>:<VoicedScene film={film} frame={frame}/>}<rect width="190" height="44" fill="#fff"/><text x="10" y="31" fill="#334c49" fontSize="25">{film.skit.id.slice(0,2)} · {t.toFixed(2)}s</text></svg>;
    const stem=path.join(root,`${film.skit.id}-${String(i).padStart(2,'0')}`);
    fs.writeFileSync(`${stem}.svg`,renderToStaticMarkup(scene));
    execFileSync('ffmpeg',['-v','error','-y','-i',`${stem}.svg`,'-vf','scale=640:360','-frames:v','1',`${stem}.png`]);
  }
  execFileSync('ffmpeg',['-v','error','-y','-framerate','1','-i',path.join(root,`${film.skit.id}-%02d.png`),'-vf','tile=4x2','-frames:v','1',path.join(root,`${film.skit.id}-sheet.png`)]);
  console.log(`Reviewed geometry: ${film.skit.id}`);
}
