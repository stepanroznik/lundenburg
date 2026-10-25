import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bundle } from '@remotion/bundler';
import { openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { loadConfig } from '../config.js';
import { brandFilms, nacht, programmeBlocks, type BrandFilm, type ProgrammeBlock } from './identity.js';
import { LogoSvg } from './Mark.js';
import { BrandBoard } from './Board.js';
import { createSignature } from './audio.js';

const project = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const mode = args[0] ?? 'stills';
if (!['stills', 'preview', 'masters'].includes(mode)) throw new Error('Use stills, preview or masters');
const app = loadConfig();
if (!/^\d+(?:\.\d+)?[kKM]$/.test(app.video.audioBitrate)) throw new Error('Unsupported audio bitrate');
const audioBitrate = app.video.audioBitrate as `${number}k` | `${number}K` | `${number}M`;
const directory = path.resolve(option('--output') ?? (mode === 'masters'
  ? path.join(app.media.generatedRoot, 'ln-brand', nacht.revision, new Date().toISOString().replace(/[:.]/g, '-')) : path.join(project, 'runtime/ln-brand')));
if (mode === 'masters' && !option('--output') && app.media.mountPoint) {
  const { assertMediaStorage } = await import('../media-storage.js'); assertMediaStorage(app);
}
const selected = option('--film');
if (selected && !Object.hasOwn(brandFilms, selected)) throw new Error('Unknown film');
const requestedBlock = option('--block') ?? 'heimat';
if (!Object.hasOwn(programmeBlocks, requestedBlock)) throw new Error('Unknown programme block');
const block = requestedBlock as ProgrammeBlock;
fs.mkdirSync(directory, { recursive: true });
const publicDirectory = path.join(project, 'runtime/ln-brand/public');
fs.mkdirSync(path.join(publicDirectory, 'fonts'), { recursive: true });
for (const font of ['DejaVuSans.ttf', 'DejaVuSerif.ttf']) fs.copyFileSync(path.join(project, 'assets/branding/fonts', font), path.join(publicDirectory, 'fonts', font));
fs.copyFileSync(path.join(project, 'assets/weather/fonts/Fredoka.ttf'), path.join(publicDirectory, 'fonts/Fredoka.ttf'));
for (const film of Object.keys(brandFilms) as BrandFilm[]) createSignature(film, path.join(publicDirectory, 'audio'));

fs.mkdirSync(path.join(project, 'assets/logo'), { recursive: true });
for (const monochrome of [false, true]) fs.writeFileSync(path.join(project, `assets/logo/ln-logo${monochrome ? '-ivory' : ''}.svg`), renderToStaticMarkup(<LogoSvg monochrome={monochrome}/>));
fs.writeFileSync(path.join(directory, 'identity.svg'), renderToStaticMarkup(<BrandBoard/>));
execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', path.join(directory, 'identity.svg'), '-frames:v', '1', '-threads', '1', path.join(directory, 'identity.png')], { stdio: 'pipe' });

const serveUrl = await bundle({ entryPoint: path.join(project, 'src/branding/video.tsx'), publicDir: publicDirectory,
  webpackOverride: config => ({ ...config, resolve: { ...config.resolve, extensionAlias: { ...config.resolve?.extensionAlias, '.js': ['.js', '.ts', '.tsx'] } } }) });
const browserExecutable = process.env.LN_BROWSER ?? process.env.INTERMISSION_BROWSER ?? '/usr/bin/chromium';
const browser = await openBrowser('chrome', { browserExecutable, chromeMode: 'chrome-for-testing', logLevel: 'error' });
const films = selected ? [selected as BrandFilm] : (Object.keys(brandFilms) as BrandFilm[]).filter(f => mode === 'masters' || !['continuity', 'day-continuity'].includes(f));
const jobs = films.flatMap(film => film === 'intro' && mode === 'masters' && !option('--block')
  ? (Object.keys(programmeBlocks) as ProgrammeBlock[]).map(block => ({ film, block })) : [{ film, block }]);
const produced: Array<{ id: string; path: string; durationMs: number; fullScreen: boolean; destination: string; sha256?: string }> = [];
try {
  for (const { film, block } of jobs) {
    const id = film === 'intro' ? `${film}-${block}` : film;
    const inputProps = { film, block, audio: true, fps: app.video.fps };
    const composition = await selectComposition({ serveUrl, id: 'StationIdentity', inputProps, puppeteerInstance: browser });
    const common = { serveUrl, composition, inputProps, puppeteerInstance: browser };
    if (mode === 'stills') {
      const seconds = film === 'evening' ? [0, 1.6, 2.8, 3.8, 4.8, 5.8, 7.1, 9.3]
        : film === 'morning' ? [0, 1.2, 2.3, 3.5, 4.8, 5.8, 7.2, 9.3]
        : film === 'ident' ? [0, .7, 1.6, 2.3, 2.9, 3.6, 4.6, 5.8] : [0, .3, .6, 1, 1.4, 1.8, 2.5, 3.8];
      for (const [i, secondsAt] of seconds.entries()) {
        await renderStill({ ...common, frame: Math.round(secondsAt * app.video.fps), imageFormat: 'png', scale: .5,
          output: path.join(directory, `${id}-${i}.png`) });
      }
      execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-framerate', '1', '-i', path.join(directory, `${id}-%d.png`),
        '-vf', 'scale=480:270,tile=4x2', '-frames:v', '1', '-threads', '1', path.join(directory, `${id}-sheet.png`)], { stdio: 'pipe' });
    } else {
      const output = path.join(directory, `${id}${mode === 'preview' ? '-preview' : ''}.mp4`);
      const temporary = output.replace(/\.mp4$/, '.partial.mp4');
      await renderMedia({ ...common, outputLocation: temporary, codec: 'h264', audioCodec: 'aac',
        audioBitrate, videoBitrate: mode === 'preview' ? '1800k' : app.video.bitrate,
        pixelFormat: 'yuv420p', x264Preset: 'fast', concurrency: 1, scale: mode === 'preview' ? .5 : 1,
        onProgress: ({ progress }) => { if (progress === 1) console.log(`${id}: rendered`); } });
      const normalized = temporary.replace('.partial.mp4', '.normalized.mp4');
      execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', temporary, '-map', '0:v:0', '-map', '0:a:0',
        '-t', String(brandFilms[film].seconds), '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast',
        '-threads', '1', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-c:a', 'aac', '-b:a', app.video.audioBitrate,
        '-ar', '48000', '-ac', '2', '-movflags', '+faststart', normalized], { stdio: 'pipe', timeout: 120_000 });
      fs.renameSync(normalized, temporary);
      const probe = JSON.parse(execFileSync(app.media.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', temporary], { encoding: 'utf8' }));
      const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
      const audio = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
      const expectedWidth = mode === 'preview' ? 960 : 1920;
      const rate = String(video?.avg_frame_rate).split('/').map(Number);
      if (video?.codec_name !== 'h264' || video.width !== expectedWidth || video.height !== expectedWidth * 9 / 16 || video.pix_fmt !== 'yuv420p' ||
        rate[0]! / rate[1]! !== app.video.fps || audio?.codec_name !== 'aac' || Number(audio.sample_rate) !== 48000 || audio.channels !== 2 ||
        Math.abs(Number(probe.format.duration) - brandFilms[film].seconds) > .1) throw new Error(`Brand master QC failed: ${id}`);
      fs.renameSync(temporary, output);
      produced.push({ id, path: output, durationMs: brandFilms[film].seconds * 1000, fullScreen: true, destination: brandFilms[film].destination });
    }
    console.log(`${mode}: ${id}`);
  }
  if (mode !== 'stills') {
    // Candidate inventory only. Activation belongs to the schedule integration.
    const manifest = path.join(directory, `${mode}-manifest.json`), temporary = `${manifest}.tmp`;
    const previous = selected && fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : undefined;
    const assets = [...(previous?.revision === nacht.revision ? previous.assets.filter((a: { id: string }) => !produced.some(p => p.id === a.id)) : []), ...produced];
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, revision: nacht.revision, status: 'review', fps: app.video.fps, assets }, null, 2));
    fs.renameSync(temporary, manifest);
  }
} finally { await browser.close({ silent: true }); }
console.log(directory);
