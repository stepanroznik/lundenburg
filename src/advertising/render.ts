import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { bundle } from '@remotion/bundler';
import { openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mixAudio, publicRoot, type Effect } from '../intermissions/audio.js';
import type { Film } from '../intermissions/model.js';
import { spokenEndFrame } from './model.js';
import type { AdBumper } from '../editorial.js';

export function bumperEffects(film: Film): Effect[] {
  const id = film.skit.cast[0]!;
  const effects: Effect[] = [];
  if (id === 'knurpsi') effects.push({ at: 32/30, duration: .13, frequency: 180, level: .10, texture: 'wood' });
  if (id === 'sisi') for (const at of [26/30,31/30]) effects.push({ at, duration: .30, frequency: 1568, level: .035, bend: 0 });
  if (id === 'schalinka') effects.push({ at: 24/30, duration: .42, frequency: 180, level: .07, texture: 'wind' });
  if (id === 'haluschka') {
    const at = (spokenEndFrame(film)+8)/30;
    effects.push({ at, duration: .2, frequency: 380, level: .045, texture: 'wood' });
    for (let i=0;i<3;i++) effects.push({ at: at+.12+i*.10, duration: .25, frequency: [659.25,783.99,1046.5][i]!, level: .025, bend: 0 });
  }
  for (let i=0;i<3;i++) effects.push({ at: (film.logoFrom+i*10)/30, duration: .35, frequency: [523.25,659.25,783.99][i]!, level: .023, bend: 0 });
  return effects;
}

export async function renderBumpers(films: Film[], outputRoot: string, ffprobe: string, stills = false): Promise<string> {
  fs.mkdirSync(path.join(publicRoot,'fonts'),{recursive:true});
  fs.copyFileSync('assets/weather/fonts/Fredoka.ttf',path.join(publicRoot,'fonts/Fredoka.ttf'));
  const reviewRoot = path.join(outputRoot,'review-animated-v2');
  fs.mkdirSync(reviewRoot,{recursive:true});
  for (const film of films) mixAudio(film,bumperEffects(film));
  const serveUrl = await bundle({ entryPoint:path.resolve('src/advertising/video/index.tsx'), publicDir:publicRoot,
    webpackOverride:c=>({...c,resolve:{...c.resolve,extensionAlias:{...c.resolve?.extensionAlias,'.js':['.js','.ts','.tsx']}}}) });
  const browserExecutable = process.env.AD_BUMPER_BROWSER || process.env.INTERMISSION_BROWSER || process.env.WEATHER_BROWSER ||
    ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',path.join(os.homedir(),'.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell')].find(f=>fs.existsSync(f));
  const browser = await openBrowser('chrome',{...(browserExecutable?{browserExecutable}:{}),logLevel:'error',
    chromeMode:browserExecutable?.includes('headless')?'headless-shell':'chrome-for-testing'});
  const staged: Array<{ partial: string; output: string; bumper: AdBumper }> = [];
  try {
    for (const film of films) {
      const inputProps={film};
      const composition=await selectComposition({serveUrl,id:'AdvertisingBumper',inputProps,puppeteerInstance:browser});
      const common={serveUrl,composition,inputProps,puppeteerInstance:browser};
      fs.writeFileSync(path.join(reviewRoot,`${film.skit.cast[0]}.json`),JSON.stringify(film,null,2));
      if (stills) {
        const frames=[0,20,32,48,60,spokenEndFrame(film)+18,135,149];
        for (const frame of [...new Set(frames)]) {
          await renderStill({...common,frame,output:path.join(reviewRoot,`${film.skit.cast[0]}-f${frame}.png`),imageFormat:'png',scale:.5});
        }
        console.log(`Reviewed-frame candidates: ${film.skit.cast[0]}`);
        continue;
      }
      const output=path.join(outputRoot,`${film.skit.cast[0]}-animated-v2.mp4`);
      const partial=output.replace(/\.mp4$/,'.partial.mp4');
      const normalized=partial.replace(/\.mp4$/,'.normalized.mp4');
      await renderMedia({...common,outputLocation:partial,codec:'h264',audioCodec:'aac',audioBitrate:'192k',videoBitrate:'3800k',
        pixelFormat:'yuv420p',x264Preset:'fast',concurrency:Number(process.env.AD_BUMPER_CONCURRENCY)||1});
      execFileSync('ffmpeg',['-y','-i',partial,'-map','0:v:0','-map','0:a:0','-t',String(film.durationInFrames/film.fps),
        '-vf','scale=in_range=pc:out_range=tv,format=yuv420p','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-ar','48000','-ac','2',
        '-movflags','+faststart',normalized],{stdio:'ignore'});
      fs.renameSync(normalized,partial);
      const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_format','-show_streams','-of','json',partial],{encoding:'utf8'})) as
        {format:{duration:string};streams:Array<{codec_type:string;codec_name:string;width?:number;height?:number;pix_fmt?:string;avg_frame_rate?:string;sample_rate?:string;channels?:number;duration?:string}>};
      const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
      const durationMs=Math.round(Number(probe.format.duration)*1000);
      if(video?.codec_name!=='h264'||video.width!==1920||video.height!==1080||video.pix_fmt!=='yuv420p'||video.avg_frame_rate!=='30/1'||
        audio?.codec_name!=='aac'||audio.sample_rate!=='48000'||audio.channels!==2||Math.abs(Number(video.duration)*1000-5000)>1||Math.abs(durationMs-5000)>100) throw new Error(`Bumper QC failed: ${film.skit.cast[0]}`);
      staged.push({partial,output,bumper:{character:film.skit.cast[0]!,mediaPath:output,durationMs}});
      console.log(`Rendered animated bumper: ${film.skit.cast[0]}`);
    }
    if(stills)return reviewRoot;
    // Only activate after ALL four masters have encoded and passed QC.
    for(const file of staged)fs.renameSync(file.partial,file.output);
    const manifest=path.join(outputRoot,'published.json'),temporary=`${manifest}.tmp`;
    fs.writeFileSync(temporary,JSON.stringify({version:1,styleRevision:'shared-rig-animated-v2',bumpers:staged.map(f=>f.bumper)},null,2));
    fs.renameSync(temporary,manifest);
    return manifest;
  } finally {
    await browser.close({silent:true});
    for(const file of staged)if(fs.existsSync(file.partial))fs.unlinkSync(file.partial);
  }
}
