import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { AppConfig } from './types.js';

export interface PreparedLogo { path: string; width: number; height: number }

// Cache only the transparent graphic, never programme pixels. Opacity and size
// are applied once before transmission; animation and compositing remain live.
export function prepareLogo(config: AppConfig): PreparedLogo {
  const key = createHash('sha256').update(fs.readFileSync(config.logo.path))
    .update(JSON.stringify([1, config.logo.width, config.logo.opacity])).digest('hex');
  const directory = path.join(config.storage.runtimeDirectory, 'graphics');
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, `${key}.png`);
  if (!fs.existsSync(output)) {
    const temporary = path.join(directory, `${key}-${randomUUID()}.png`);
    try {
      const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin',
        '-threads', '1', '-i', config.logo.path, '-filter_threads', '1',
        '-vf', `scale=${config.logo.width}:-1,format=rgba,colorchannelmixer=aa=${config.logo.opacity}`,
        '-frames:v', '1', '-threads', '1', '-update', '1', temporary], { encoding: 'utf8', timeout: 30_000 });
      if (result.status !== 0) throw new Error(`Logo preparation failed: ${result.error?.message ?? result.stderr}`);
      fs.renameSync(temporary, output);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  const png = fs.readFileSync(output);
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`Invalid cached logo: ${output}`);
  }
  return { path: output, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export interface LogoFrame { angleRadians: number; scale: number; progress: number }

export function logoFrame(elapsedMs: number, durationMs: number, rotations: number, maximumScale: number): LogoFrame {
  const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
  const eased = 1 - Math.pow(1 - progress, 3);
  return {
    progress,
    angleRadians: eased * Math.PI * 2 * rotations,
    scale: 1 + (maximumScale - 1) * Math.sin(Math.PI * eased),
  };
}
