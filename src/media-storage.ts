import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AppConfig } from './types.js';

export function assertMediaStorage(config: AppConfig): void {
  if (!fs.existsSync(config.media.root)) throw new Error(`Media root does not exist: ${config.media.root}`);
  if (!config.media.mountPoint) return;
  let target = '';
  try {
    target = execFileSync('findmnt', ['-n', '-o', 'TARGET', '--target', config.media.root], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`Media drive is not mounted at ${config.media.mountPoint}`);
  }
  if (path.resolve(target) !== path.resolve(config.media.mountPoint)) {
    throw new Error(`Media root is on ${target || 'an unknown filesystem'}, expected ${config.media.mountPoint}`);
  }
}

export function generatedShowRoot(config: AppConfig, show: 'weather' | 'intermissions'): string {
  return path.join(config.media.generatedRoot, show === 'weather' ? 'lkp-wetterfreunde' : 'lkp-pausenfilme');
}
