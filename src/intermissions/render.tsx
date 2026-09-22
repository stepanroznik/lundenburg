import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bundle } from '@remotion/bundler';
import { openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mixAudio, publicRoot } from './audio.js';
import { filmRevision, isCurrentRender } from './revision.js';
import { Logo } from './video/Logo.js';
import { manifestRoot } from './prepare.js';
import type { Film } from './model.js';

export const outputRoot = path.resolve('runtime/intermissions');
export function readFilms(ids: string[], preview = false): Film[] {
  const files = fs.readdirSync(manifestRoot).filter(f => f.endsWith(preview?'.preview.json':'.json') && (preview||!f.endsWith('.preview.json')));
  const films = files.map(f=>JSON.parse(fs.readFileSync(path.join(manifestRoot,f),'utf8')) as Film).filter(f=>!ids.length||ids.includes(f.skit.id)).sort((a,b)=>a.skit.id.localeCompare(b.skit.id));
  if (!films.length || ids.some(id=>!films.some(f=>f.skit.id===id))) throw new Error('Missing prepared film. Run intermissions:prepare first.');
  return films;
}

export function prepareBrand() {
  fs.mkdirSync(path.join(publicRoot,'fonts'),{recursive:true});
  fs.copyFileSync('assets/weather/fonts/Fredoka.ttf',path.join(publicRoot,'fonts/Fredoka.ttf'));
  const directory = path.join(outputRoot,'brand'); fs.mkdirSync(directory,{recursive:true});
  const font = fs.readFileSync('assets/weather/fonts/Fredoka.ttf').toString('base64');
  const logo = renderToStaticMarkup(<Logo/>).replace('<rect',`<style>@font-face{font-family:Fredoka;src:url(data:font/ttf;base64,${font}) format('truetype');font-weight:300 700}</style><rect`);
  fs.writeFileSync(path.join(directory,'lkp-premium.svg'),logo);
  fs.copyFileSync('assets/logo/lkp-logo.svg',path.join(directory,'channel-icon.svg'));
}

function captionTime(seconds: number, comma: boolean) {
  const ms = Math.round(seconds*1000);
  return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}${comma?',':'.'}${String(ms%1000).padStart(3,'0')}`;
}
export function writeCaptions(film: Film) {
  const dir = path.join(outputRoot,'videos'); fs.mkdirSync(dir,{recursive:true});
  const stem = `${film.skit.id}${film.preview?'.preview':''}`;
  const captions = film.cues.map((c,i)=>`${i+1}\n${captionTime(c.from/film.fps,true)} --> ${captionTime((c.from+c.frames)/film.fps,true)}\n${c.text}\n`).join('\n');
  fs.writeFileSync(path.join(dir,`${stem}.srt`),captions);
  fs.writeFileSync(path.join(dir,`${stem}.vtt`),'WEBVTT\n\n'+film.cues.map(c=>`${captionTime(c.from/film.fps,false)} --> ${captionTime((c.from+c.frames)/film.fps,false)}\n${c.text}\n`).join('\n'));
}

export async function renderSet(ids: string[], options: { stills?: boolean; preview?: boolean; scale?: number; skipExisting?: boolean; seconds?: number[] } = {}) {
  const films = readFilms(ids,options.preview);
  prepareBrand();
  if (!options.stills) for(const film of films) { mixAudio(film); writeCaptions(film); }
  const serveUrl = await bundle({entryPoint:path.resolve('src/intermissions/video/index.tsx'),publicDir:publicRoot,
    webpackOverride:c=>({...c,resolve:{...c.resolve,extensionAlias:{...c.resolve?.extensionAlias,'.js':['.js','.ts','.tsx']}}})});
  const browserExecutable = process.env.INTERMISSION_BROWSER || process.env.WEATHER_BROWSER || ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',path.join(os.homedir(),'.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell')].find(f=>fs.existsSync(f));
  const browser = await openBrowser('chrome', {...(browserExecutable?{browserExecutable}:{}),logLevel:'error',chromeMode:browserExecutable?.includes('headless')?'headless-shell':'chrome-for-testing'});
  try {
    for (const film of films) {
      const inputProps = {film};
      const composition = await selectComposition({serveUrl,id:'Intermission',inputProps,puppeteerInstance:browser});
      const common = {serveUrl,composition,inputProps,puppeteerInstance:browser};
      const partialPreview = film.preview || (options.scale ?? 1) !== 1;
      const stem = `${film.skit.id}${partialPreview?'.preview':''}`;
      if (options.stills) {
        const dir=path.join(outputRoot,'stills');fs.mkdirSync(dir,{recursive:true});
        // Three story beats plus the ending, for checking staging and the logo.
        const frames=options.seconds?.map(s=>Math.round(s*film.fps))??[.18,.48,.78,.995].map((p,i)=>Math.floor((i===3?film.durationInFrames:film.logoFrom)*p));
        for (const [i,f] of frames.entries()) {
          await renderStill({...common,output:path.join(dir,`${stem}-${options.seconds?`f${f}`:i+1}.png`),frame:Math.min(film.durationInFrames-1,f),imageFormat:'png',scale:options.scale??.5});
        }
        console.log(`Stills: ${stem}`); continue;
      }
      const output=path.join(outputRoot,'videos',`${stem}.mp4`);
      if(options.skipExisting && !partialPreview && isCurrentRender(film)) {console.log(`Existing: ${stem}`);continue;}
      const began=Date.now(); let step=-1;
      const partial=output.replace(/\.mp4$/,'.partial.mp4');
      await renderMedia({...common,outputLocation:partial,codec:'h264',audioCodec:'aac',audioBitrate:'192k',videoBitrate:'3800k',pixelFormat:'yuv420p',x264Preset:'fast',concurrency:Number(process.env.INTERMISSION_CONCURRENCY)||2,scale:options.scale??1,
        onProgress:p=>{const next=Math.floor(p.progress*4);if(next!==step){step=next;console.log(`${stem}: ${next*25}%`);}}});
      fs.renameSync(partial,output);
      fs.writeFileSync(output.replace(/\.mp4$/,'.json'),JSON.stringify({id:film.skit.id,title:film.skit.title,kind:film.skit.kind,season:film.skit.season??'all',durationSeconds:film.durationInFrames/film.fps,cast:film.skit.cast,languages:[...new Set(film.skit.lines.map(l=>l.language))],synopsis:film.skit.synopsis,sources:film.skit.sources??[],preview:partialPreview,renderRevision:filmRevision(film),renderSeconds:(Date.now()-began)/1000},null,2));
      console.log(`Rendered ${stem}: ${((Date.now()-began)/1000).toFixed(1)}s`);
    }
  } finally { await browser.close({silent:true}); }
}
