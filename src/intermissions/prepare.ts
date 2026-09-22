import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SpeechCache } from '../weather/speech.js';
import { loadWeatherConfig } from '../weather/config.js';
import type { Atom } from '../weather/model.js';
import { catalogue, validateCatalogue } from './catalogue.js';
import type { Film, Skit } from './model.js';

export async function prepareFilm(skit: Skit, mode: 'tts' | 'cache' | 'silent' = 'cache'): Promise<Film> {
  validateCatalogue([skit]);
  const fps = 30;
  const cues: Film['cues'] = [];
  let cursor = Math.round((skit.lead ?? .5) * fps);
  // Silent skits never construct a speech provider and cannot spend TTS credits.
  if (skit.kind !== 'silent') {
    const cache = new SpeechCache(loadWeatherConfig(), mode);
    for (const [i, l] of skit.lines.entries()) {
      const atom: Atom = { id: `${skit.id}-${i}`, presenter: l.speaker, language: l.language, text: l.text, purpose: 'reaction', period: 'current' };
      let asset = await cache.get(atom, l.direction);
      // The ident is a quick exchange: discard TTS padding and modestly tighten delivery.
      if (skit.kind === 'ident' && asset.audio) {
        const voiced = asset.cues.filter(c => c.value !== 'rest');
        const first = Math.max(0, (voiced[0]?.start ?? 0) - .045);
        const last = Math.min(asset.duration, (voiced.at(-1)?.end ?? asset.duration) + .075);
        const speed = 1.12;
        const audio = `intermissions/ident/${asset.key}-tight-v1.wav`;
        const file = path.join('runtime/weather/public', audio);
        fs.mkdirSync(path.dirname(file), {recursive:true});
        if (!fs.existsSync(file)) execFileSync('ffmpeg', ['-v','error','-nostdin','-i',path.join('runtime/weather/public',asset.audio),'-af',`atrim=start=${first}:end=${last},asetpts=PTS-STARTPTS,atempo=${speed}`,'-ar','48000','-ac','2',file]);
        const duration = Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',file],{encoding:'utf8'}).trim());
        asset = {...asset, key: `${asset.key}-tight-v1`, audio, duration,
          cues: asset.cues.filter(c=>c.end>first&&c.start<last).map(c=>({...c,start:Math.max(0,c.start-first)/speed,end:Math.min(last-first,c.end-first)/speed}))};
      }
      const frames = Math.ceil(asset.duration * fps);
      cues.push({ ...l, from: cursor, frames, asset });
      cursor += frames + Math.round((l.pauseAfter ?? .2) * fps);
      console.log(`${skit.id} ${i + 1}/${skit.lines.length}: ${asset.duration.toFixed(2)}s ${l.speaker}`);
    }
  }
  const logoFrom = skit.kind === 'silent' ? Math.round((skit.seconds! - 1) * fps) : cursor + Math.round((skit.tail ?? .6) * fps);
  const durationInFrames = skit.kind === 'ident' ? logoFrom + 30 : logoFrom + (skit.fact ? 90 : 30);
  return { skit, fps, cues, logoFrom, durationInFrames, sfx: `intermissions/sfx/${skit.id}.wav`, preview: skit.kind !== 'silent' && mode === 'silent' };
}

export const manifestRoot = 'runtime/intermissions/manifests';
export async function prepareSet(ids: string[], mode: 'tts' | 'cache' | 'silent') {
  validateCatalogue();
  const selected = ids.length ? catalogue.filter(s => ids.includes(s.id)) : catalogue;
  if (ids.some(id => !catalogue.some(s => s.id === id))) throw new Error('Unknown skit id');
  fs.mkdirSync(manifestRoot, { recursive: true });
  for (const skit of selected) {
    const film = await prepareFilm(skit, mode);
    const file = path.join(manifestRoot, `${skit.id}${film.preview ? '.preview' : ''}.json`);
    fs.writeFileSync(file, JSON.stringify(film, null, 2));
    console.log(`Prepared ${file}: ${(film.durationInFrames / film.fps).toFixed(2)}s`);
  }
}
