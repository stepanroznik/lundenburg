import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AppConfig } from './types.js';

interface MountedFilesystem { target: string; 'maj:min': string; fstype: string }

export function mediaFilesystemMatches(root: string, mountPoint: string, media: MountedFilesystem, mounted: MountedFilesystem): boolean {
  const relative = path.relative(mountPoint, root);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    && path.resolve(mounted.target) === path.resolve(mountPoint)
    && Boolean(media['maj:min']) && media['maj:min'] === mounted['maj:min']
    && Boolean(media.fstype) && media.fstype === mounted.fstype;
}

export function assertMediaStorage(config: AppConfig): void {
  if (!fs.existsSync(config.media.root)) throw Object.assign(new Error('Media root does not exist'), { code: 'MEDIA_ROOT_MISSING' });
  if (!config.media.mountPoint) return;
  let root: string, mountPoint: string, media: MountedFilesystem, mounted: MountedFilesystem;
  try {
    root = fs.realpathSync(config.media.root);
    mountPoint = fs.realpathSync(config.media.mountPoint);
    const query = (option: string, target: string): MountedFilesystem => {
      const result = JSON.parse(execFileSync('findmnt', ['--json', '-o', 'TARGET,MAJ:MIN,FSTYPE', option, target], { encoding: 'utf8', timeout: 5000 }));
      const filesystem = result.filesystems?.[0];
      if (!filesystem || typeof filesystem.target !== 'string') throw new Error('Mount identity unavailable');
      return filesystem;
    };
    media = query('--target', root);
    mounted = query('--mountpoint', mountPoint);
  } catch {
    throw Object.assign(new Error('Configured media drive is not mounted'), { code: 'MEDIA_MOUNT_MISSING' });
  }
  // ReadWritePaths creates a bind mount at the library root. Its target differs,
  // but it must still be backed by the actual, explicitly mounted media drive.
  if (!mediaFilesystemMatches(root, mountPoint, media, mounted)) {
    throw Object.assign(new Error('Media root is not on the configured media drive'), { code: 'MEDIA_MOUNT_MISMATCH' });
  }
}

export function generatedShowRoot(config: AppConfig, show: 'weather' | 'intermissions'): string {
  return path.join(config.media.generatedRoot, show === 'weather' ? 'lkp-wetterfreunde' : 'lkp-pausenfilme');
}
