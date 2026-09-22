import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Film } from './model.js';

export const publicRoot = path.resolve('runtime/weather/public');
type Effect = { at: number; duration: number; frequency: number; level: number; noise?: number; bend?: number; texture?: 'water'|'leaves'|'wind'|'snow'|'rubber'|'soil'|'wood' };

export function effectsFor(f: Film): Effect[] {
  const effects: Effect[] = [];
  const tone = (at: number, frequency = 450, duration = .16, level = .085, noise = 0, bend = -.6) => effects.push({ at, frequency, duration, level, noise, bend });
  const splash = (at: number, duration = .6, level = .07) => tone(at, 1500, duration, level, .9, -.8);
  const foley = (texture: NonNullable<Effect['texture']>, at: number, duration: number, level: number, frequency=220) => effects.push({at,duration,level,frequency,texture});
  const cue = (i: number) => (f.cues[i]?.from ?? 0) / 30;
  switch (f.skit.scene) {
    case 'ident': f.cues.forEach((c,i)=>tone(c.from/30+.1,[523.25,659.25,783.99][i]!, .5,.035,0,0)); break;
    case 'soap': splash(.3, f.logoFrom/30-.5, .025); break;
    case 'dam': foley('wood',.5,.12,.06,180); foley('wood',cue(f.cues.length-3)+.8,.14,.07,160); break;
    case 'biscuits': tone(cue(2)+.4,590,.12,.035); tone(cue(5)+.8,780,.15,.035); break;
    case 'puddles': foley('soil',.7,.12,.045); foley('soil',1.2,.12,.04); foley('water',3.05,.8,.16,870); foley('water',3.92,.2,.075,1800); foley('water',4.57,.5,.09,1250); break;
    case 'flowers': foley('soil',2.15,.45,.08); foley('wood',3.65,.08,.025,330); foley('water',4.7,1.45,.04,2300); foley('wood',7.2,.1,.035,280); break;
    case 'pool': foley('water',.5,8.5,.025,680); for(let i=0;i<8;i++)foley('water',1.2+i*.8,.26,.045,600+i%3*190); break;
    case 'beachball': foley('rubber',1.25,.2,.08,145); foley('rubber',2.85,.25,.06,185); foley('rubber',5.3,.18,.07,210); foley('rubber',6.9,.22,.065,130); break;
    case 'leaves': foley('leaves',.4,2,.055); foley('leaves',3.65,1.25,.16); foley('leaves',5.7,1.1,.075); break;
    case 'kite': foley('wind',.4,8.9,.04,95); foley('soil',.8,.1,.035); foley('soil',1.3,.1,.035); foley('wood',3.8,.14,.035,370); foley('leaves',5.4,.6,.028); break;
    case 'snowballs': foley('wind',1.5,.24,.025,130); foley('snow',2.6,.3,.14); foley('snow',4,.7,.13); break;
    case 'snowman': foley('snow',1.1,.35,.06); foley('snow',2.8,.3,.09); foley('snow',3.6,.24,.045); foley('snow',5,.25,.07); foley('snow',6.15,.14,.035); foley('snow',9.1,.3,.05); break;
  }
  return effects;
}

// Original procedural Foley. Silent clips use no network, voice, or speech cache.
export function writeEffects(film: Film): string {
  const rate = 48000, samples = Math.ceil(film.durationInFrames / film.fps * rate);
  const buffer = Buffer.alloc(44 + samples * 4);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16,16); buffer.writeUInt16LE(1,20); buffer.writeUInt16LE(2,22);
  buffer.writeUInt32LE(rate,24); buffer.writeUInt32LE(rate*4,28); buffer.writeUInt16LE(4,32); buffer.writeUInt16LE(16,34);
  buffer.write('data',36); buffer.writeUInt32LE(samples*4,40);
  const effects = effectsFor(film);
  let seed = [...film.skit.id].reduce((n,c)=>Math.imul(n,31)+c.charCodeAt(0),12877)>>>0;
  let previous = 0, low = 0, lastNoise = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
    const noise = seed/2147483648-1;
    previous = previous*.65 + noise*.35;
    low = low*.994 + noise*.006;
    const high=noise-lastNoise; lastNoise=noise;
    let value = 0;
    for (const e of effects) {
      const dt = t-e.at;
      if (dt < 0 || dt >= e.duration) continue;
      const p = dt/e.duration;
      const envelope = Math.min(1,dt*80) * (e.duration>1 ? Math.min(1,(e.duration-dt)*8) : Math.exp(-p*4)*(1-p));
      const phase = 2*Math.PI*e.frequency*(dt+(e.bend??0)*dt*dt/(2*e.duration));
      let wave=((1-(e.noise??0))*Math.sin(phase)+(e.noise??0)*previous);
      if(e.texture==='water') wave=previous*.9+Math.sin(phase*(1+.09*Math.sin(dt*43)))*.2*(.5+.5*Math.sin(dt*67))**8;
      if(e.texture==='leaves') wave=high*.34*(.18+.82*Math.abs(Math.sin(dt*37)*Math.sin(dt*91)))+previous*.12;
      if(e.texture==='wind') wave=low*5*(.55+.35*Math.sin(dt*2.6)+.1*Math.sin(dt*7));
      if(e.texture==='snow') wave=previous*.8*Math.exp(-p*2)+high*.13*(.5+.5*Math.sin(dt*143));
      if(e.texture==='rubber') wave=Math.sin(2*Math.PI*e.frequency*(dt-.27*dt*dt/e.duration))*.8+previous*.08;
      if(e.texture==='soil') wave=previous*.6+high*.12*(Math.sin(dt*97)>.6?1:0);
      if(e.texture==='wood') wave=Math.sin(phase)*.6+Math.sin(phase*2.73)*.18+high*.12*Math.exp(-dt*40);
      value += wave*e.level*envelope;
    }
    const sample = Math.round(Math.max(-.5,Math.min(.5,value))*32767);
    buffer.writeInt16LE(sample,44+i*4); buffer.writeInt16LE(sample,46+i*4);
  }
  const output = path.join(publicRoot,film.sfx);
  fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,buffer);
  return output;
}

export function mixAudio(film: Film): string {
  const sfx = writeEffects(film);
  const output = path.join(publicRoot, `intermissions/audio/${film.skit.id}${film.preview?'.preview':''}.wav`);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const args = ['-v','error','-nostdin','-y','-i',sfx];
  const filters: string[] = [];
  let index = 1;
  for (const cue of film.cues) {
    if (!cue.asset.audio) continue;
    const file = path.join(publicRoot,cue.asset.audio);
    if (!fs.existsSync(file)) throw new Error(`Missing speech asset: ${file}`);
    args.push('-i',file);
    filters.push(`[${index}:a]adelay=${Math.round(cue.from/film.fps*1000)}:all=1[a${index}]`);
    index++;
  }
  filters.push(`[0:a]${Array.from({length:index-1},(_,i)=>`[a${i+1}]`).join('')}amix=inputs=${index}:normalize=0:duration=first,alimiter=limit=0.79:level=false:latency=true[out]`);
  args.push('-filter_complex',filters.join(';'),'-map','[out]','-ar','48000','-ac','2','-c:a','pcm_s16le',output);
  execFileSync('ffmpeg',args,{timeout:120000,stdio:'pipe'});
  return output;
}
