import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { Episode } from './model.js';
import type { RegionMap } from './geography.js';
import type { WeatherConfig } from './config.js';

export async function bundleWeather(): Promise<string> {
  return bundle({
    entryPoint: path.resolve('src/weather/video/index.tsx'),
    publicDir: path.resolve('runtime/weather/public'),
    // NodeNext source imports use .js specifiers; Webpack must also resolve
    // those specifiers to the original .ts/.tsx files before compilation.
    webpackOverride: (configuration) => ({
      ...configuration,
      resolve: {
        ...configuration.resolve,
        extensionAlias: {
          ...configuration.resolve?.extensionAlias,
          '.js': ['.js', '.ts', '.tsx'],
        },
      },
    }),
  });
}

export function prepareSting(): void {
  const root = 'runtime/weather/public';
  fs.mkdirSync(root, { recursive: true });
  // Original, restrained three-second marimba-style ident; no external music licence.
  const rate = 48000, samples = rate * 3;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    let sum = 0;
    notes.forEach((hz, j) => { const d = t - j * .38; if (d >= 0) sum += Math.sin(d * hz * 2 * Math.PI) * Math.exp(-d * 5) * Math.min(1, d * 100) * .15; });
    data.writeInt16LE(Math.round(sum * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(root, 'sting.wav'), data);
}
export async function renderEpisode(episode: Episode, output: string, c: WeatherConfig, options: { still?: number; scale?: number; frames?: [number, number] } = {}): Promise<void> {
  const mapPath = 'assets/weather/region.json';
  if (!fs.existsSync(mapPath)) throw new Error('Real map snapshot missing. Run npm run weather:map first.');
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as RegionMap;
  if (!map.features?.length) throw new Error('Real map snapshot is empty');
  prepareSting();
  const serveUrl = await bundleWeather();
  const browserExecutable = process.env.WEATHER_BROWSER || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  const inputProps = { episode, map };
  const composition = await selectComposition({ serveUrl, id: 'Weather', inputProps, ...(browserExecutable ? { browserExecutable } : {}) });
  const common = { serveUrl, composition, inputProps, outputLocation: output, ...(browserExecutable ? { browserExecutable } : {}) };
  if (options.still !== undefined) { await renderStill({ ...common, frame: options.still, imageFormat: 'png', scale: options.scale ?? 1 }); return; }
  await renderMedia({ ...common, codec: 'h264', audioCodec: 'aac', audioBitrate: '192k', videoBitrate: '3800k', pixelFormat: 'yuv420p', x264Preset: 'medium', concurrency: c.concurrency, scale: options.scale ?? 1, ...(options.frames ? { frameRange: options.frames } : {}), onProgress: ({ progress }) => { if (Math.floor(progress * 100) % 10 === 0) process.stdout.write(`\rRendering ${Math.round(progress * 100)}%`); } });
  process.stdout.write('\n');
}
