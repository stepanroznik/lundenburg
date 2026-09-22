import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { presenter, type WeatherConfig } from './config.js';
import type { Atom, Mouth, MouthCue, SpeechAsset } from './model.js';
import { acquireWeatherLock } from './lock.js';

const run = promisify(execFile);
export const speechRoot = path.resolve('runtime/weather/public/speech');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const cacheHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export interface SpeechDirection { speed?: number; stability?: number; style?: number; previousText?: string; nextText?: string; }
export function spokenNames(text: string, language: string): string {
  if (language !== 'cs' && language !== 'sk') return text;
  return text.replace(/Haluschka/g, 'Haluška').replace(/Haluschko/g, 'Haluško').replace(/Schalinka/g, 'Šalinka').replace(/Schalinko/g, 'Šalinko');
}
export function speechParameters(atom: Atom, c: WeatherConfig, direction?: SpeechDirection) {
  const p = presenter(atom.presenter);
  return {
    version: 1, provider: 'elevenlabs', voiceId: p.voiceId, model: c.model,
    language: atom.language, text: spokenNames(atom.text, atom.language), speed: direction?.speed ?? p.speed,
    voiceSettings: { ...c.voiceSettings, speed: direction?.speed ?? p.speed,
      ...(direction?.stability === undefined ? {} : {stability: direction.stability}),
      ...(direction?.style === undefined ? {} : {style: direction.style}) }, outputFormat: 'mp3_44100_128',
    ...(direction ? { direction } : {}),
    processing: { profile: p.profile, eq: p.eq, loudnessLufs: c.loudnessLufs, truePeakDb: c.truePeakDb, lra: 7, sampleRate: 48000, channels: 2 },
    lipsync: 'character-alignment-v1',
  };
}
interface Alignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
export function alignmentCues(alignment: Alignment): MouthCue[] {
  if (!alignment || !Array.isArray(alignment.characters) || alignment.characters.length !== alignment.character_start_times_seconds?.length || alignment.characters.length !== alignment.character_end_times_seconds?.length) throw new Error('Missing speech alignment');
  let lastStart = 0;
  return alignment.characters.map((char, i) => {
    const c = char.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const value: Mouth = /[bmp]/.test(c) ? 'closed' : /[ou]/.test(c) ? 'round' : /[fv]/.test(c) ? 'teeth' : /[ei]/.test(c) ? 'wide' : /[a]/.test(c) ? 'open' : /\s|[.,!?;:]/.test(c) ? 'rest' : 'wide';
    const start = alignment.character_start_times_seconds[i]!;
    const end = alignment.character_end_times_seconds[i]!;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < lastStart || end < start) throw new Error('Invalid speech alignment timing');
    lastStart = start;
    return { start, end, value };
  });
}
export async function probeDuration(file: string): Promise<number> {
  const result = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: 20_000 });
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid audio/video duration: ${file}`);
  return duration;
}
function readKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const file = path.resolve('runtime/weather/credentials.env');
  const value = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).find(line => line.startsWith('ELEVENLABS_API_KEY='))?.slice('ELEVENLABS_API_KEY='.length).trim() : undefined;
  if (!value) throw new Error('ELEVENLABS_API_KEY is required for uncached speech');
  return value;
}
export interface SpeechStats { hits: number; misses: number; characters: number }
export class SpeechCache {
  readonly stats: SpeechStats = { hits: 0, misses: 0, characters: 0 };
  constructor(private c: WeatherConfig, private mode: 'tts' | 'cache' | 'silent' = 'tts', private request: typeof fetch = fetch) {}
  async get(atom: Atom, direction?: SpeechDirection): Promise<SpeechAsset> {
    const parameters = speechParameters(atom, this.c, direction);
    const key = cacheHash(parameters);
    const directory = path.join(speechRoot, key);
    const metadataFile = path.join(directory, 'asset.json');
    if (fs.existsSync(metadataFile) && fs.existsSync(path.join(directory, 'speech.wav'))) {
      const asset = JSON.parse(fs.readFileSync(metadataFile, 'utf8')) as SpeechAsset;
      if (asset.key !== key || !(asset.duration > 0) || !Array.isArray(asset.cues)) throw new Error(`Corrupt speech cache: ${key}`);
      this.stats.hits++;
      this.usage(atom, key, true, 0);
      return asset;
    }
    if (this.mode === 'silent') return { key: `silent-${key}`, audio: '', duration: Math.max(1.4, atom.text.length / 13), cues: [] };
    if (this.mode === 'cache') throw new Error(`Uncached speech for ${atom.presenter}: ${atom.text}`);
    fs.mkdirSync(directory, { recursive: true });
    const lock = path.join(directory, '.lock');
    const unlock = acquireWeatherLock(lock);
    try {
      const rawFile = path.join(directory, 'source.mp3');
      const alignmentFile = path.join(directory, 'alignment.json');
      if (!fs.existsSync(rawFile) || !fs.existsSync(alignmentFile)) {
        // Only the TTS endpoint is used. Voice metadata/list permission is never required.
        const response = await this.request(`https://api.elevenlabs.io/v1/text-to-speech/${parameters.voiceId}/with-timestamps?output_format=${parameters.outputFormat}`, {
          method: 'POST', headers: { 'xi-api-key': readKey(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: parameters.text, language_code: parameters.language, model_id: parameters.model, voice_settings: parameters.voiceSettings,
            ...(direction?.previousText ? {previous_text: spokenNames(direction.previousText, atom.language)} : {}),
            ...(direction?.nextText ? {next_text: spokenNames(direction.nextText, atom.language)} : {}) }),
          signal: AbortSignal.timeout(25_000),
        });
        if (!response.ok) throw new Error(`ElevenLabs TTS failed for ${atom.presenter}: HTTP ${response.status}. Generation stopped; no automatic paid retry.`);
        this.stats.misses++;
        this.stats.characters += atom.text.length;
        this.usage(atom, key, false, atom.text.length);
        const data = await response.json() as { audio_base64: string; normalized_alignment?: Alignment; alignment?: Alignment };
        const alignment = data.normalized_alignment ?? data.alignment;
        const cues = alignmentCues(alignment!);
        if (!data.audio_base64 || !cues.length) throw new Error('Empty TTS audio or alignment');
        fs.writeFileSync(rawFile, Buffer.from(data.audio_base64, 'base64'));
        fs.writeFileSync(alignmentFile, JSON.stringify(alignment));
      }
      const processing = parameters.processing;
      const loudnorm = `loudnorm=I=${processing.loudnessLufs}:TP=${processing.truePeakDb}:LRA=${processing.lra}`;
      const measurement = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', rawFile, '-af', `${processing.eq},${loudnorm}:print_format=json`, '-f', 'null', '-'], { timeout: 25_000 });
      const match = /\{\s*"input_i"[\s\S]*?\}/.exec(measurement.stderr);
      if (!match) throw new Error('Could not measure speech loudness');
      const measured = JSON.parse(match[0]) as Record<string, string>;
      if (!['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].every(k => Number.isFinite(Number(measured[k])))) throw new Error('Invalid loudness measurement');
      const filter = `${processing.eq},${loudnorm}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
      const audioFile = path.join(directory, 'speech.wav');
      await run('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', rawFile, '-af', filter, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', `${audioFile}.tmp.wav`], { timeout: 25_000 });
      fs.renameSync(`${audioFile}.tmp.wav`, audioFile);
      const duration = await probeDuration(audioFile);
      const cues = alignmentCues(JSON.parse(fs.readFileSync(alignmentFile, 'utf8')) as Alignment);
      const asset: SpeechAsset = { key, audio: `speech/${key}/speech.wav`, duration, cues };
      fs.writeFileSync(path.join(directory, 'speech.lipsync.json'), JSON.stringify({ method: parameters.lipsync, cues }));
      fs.writeFileSync(path.join(directory, 'parameters.json'), JSON.stringify(parameters, null, 2));
      fs.writeFileSync(path.join(directory, 'loudness.json'), JSON.stringify(measured));
      fs.writeFileSync(`${metadataFile}.tmp`, JSON.stringify(asset));
      fs.renameSync(`${metadataFile}.tmp`, metadataFile);
      return asset;
    } finally { unlock(); }
  }
  private usage(atom: Atom, key: string, hit: boolean, characters: number) {
    fs.mkdirSync('runtime/weather', { recursive: true });
    fs.appendFileSync('runtime/weather/usage.jsonl', `${JSON.stringify({ at: new Date().toISOString(), presenter: atom.presenter, voice: presenter(atom.presenter).voiceId, text: atom.text, key, hit, characters })}\n`);
  }
}
