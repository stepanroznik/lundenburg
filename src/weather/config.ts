import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { Edition } from './model.js';

export { presenters, presenter, weatherStyle } from './characters.js';
export interface WeatherConfig {
  timezone: string; starts: Record<Edition, number>; generationLeadMinutes: number;
  maxForecastAgeMinutes: number; model: string; loudnessLufs: number; truePeakDb: number;
  voiceSettings: { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean };
  fps: number; width: number; height: number; concurrency: number;
}
export function loadWeatherConfig(): WeatherConfig {
  const c = parse(fs.readFileSync(path.resolve('config/weather.yaml'), 'utf8')) as WeatherConfig;
  if (c.timezone !== 'Europe/Prague' || c.fps !== 30 || c.width !== 1920 || c.height !== 1080) throw new Error('Weather output must match the LKP Europe/Prague, 1080p30 profile');
  const hours = [c.starts.morning, c.starts.afternoon, c.starts.evening];
  if (hours.some((h, i) => !Number.isInteger(h) || h < 0 || h > 23 || (i > 0 && h <= hours[i - 1]!))) throw new Error('Edition start hours must be increasing integers');
  if (!(c.maxForecastAgeMinutes > 0 && c.generationLeadMinutes > 0 && c.concurrency > 0)) throw new Error('Invalid weather timing/concurrency configuration');
  return c;
}
