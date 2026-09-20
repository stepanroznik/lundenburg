import type { Atom, Beat, Edition, Episode, Forecast, SpeechAsset } from './model.js';

export async function assembleEpisode(forecast: Forecast, edition: Edition, atoms: Atom[], get: (atom: Atom) => Promise<SpeechAsset>, fps = 30, preview = false): Promise<Episode> {
  let cursor = 3 * fps;
  const beats: Beat[] = [];
  for (const atom of atoms) {
    const asset = await get(atom);
    const frames = Math.ceil(asset.duration * fps);
    beats.push({ ...atom, asset, from: cursor, frames });
    cursor += frames + Math.round(fps * (atom.purpose === 'handoff' ? 0.65 : 0.3));
  }
  return { edition, broadcastAt: forecast.broadcastAt, forecast, beats, fps, durationInFrames: cursor + 3 * fps, preview };
}
function stamp(seconds: number, separator: string): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
}
export function subtitles(episode: Episode, kind: 'vtt' | 'srt', language?: string): string {
  const beats = episode.beats.filter(b => !language || b.language === language);
  return (kind === 'vtt' ? 'WEBVTT\n\n' : '') + beats.map((b, i) => `${kind === 'srt' ? `${i + 1}\n` : ''}${stamp(b.from / episode.fps, kind === 'vtt' ? '.' : ',')} --> ${stamp((b.from + b.frames) / episode.fps, kind === 'vtt' ? '.' : ',')}\n${b.text}\n`).join('\n');
}
