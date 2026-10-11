#!/usr/bin/env node
// Restore an existing media volume and persist its mount. Never formats,
// repairs, force-mounts, unmounts, or controls broadcast/acquisition services.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const check = process.argv.includes('--check');
const uuid = process.argv.slice(2).find(value => value !== '--check');
const target = '/mnt/lkp-media';
const run = (file, args) => execFileSync(file, args, {
  encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

try {
  if (!uuid || !/^[A-Fa-f0-9-]+$/.test(uuid)) throw new Error('Supply the existing NTFS media volume UUID.');
  if (!check && process.getuid() !== 0) throw new Error('Run with sudo, or use --check for a read-only preview.');
  const devices = JSON.parse(run('lsblk', ['--json', '--output', 'UUID,FSTYPE,MOUNTPOINTS']));
  const flatten = items => items.flatMap(item => [item, ...flatten(item.children ?? [])]);
  const matches = flatten(devices.blockdevices).filter(item => item.uuid?.toUpperCase() === uuid.toUpperCase());
  if (matches.length !== 1 || matches[0].fstype !== 'ntfs') throw new Error('Expected exactly one connected NTFS volume with this UUID.');
  const mounts = matches[0].mountpoints?.filter(Boolean) ?? [];
  if (mounts.some(value => value !== target)) throw new Error('This volume is mounted elsewhere; refusing to change its mount.');
  if (!fs.statSync(target).isDirectory() || fs.realpathSync(target) !== target) throw new Error('The media mount directory must already exist and must not be a symlink.');
  let mountedUuid;
  try { mountedUuid = run('findmnt', ['--noheadings', '--output', 'UUID', '--mountpoint', target]); }
  catch (error) { if (error.status !== 1) throw error; }
  if (mountedUuid !== undefined && mountedUuid.toUpperCase() !== uuid.toUpperCase()) throw new Error('A different filesystem is mounted at the media directory.');
  const uid = run('id', ['-u', 'lundenburg']);
  const gid = run('id', ['-g', 'lundenburg']);
  const options = `uid=${uid},gid=${gid},umask=0022,nofail,x-systemd.device-timeout=10s`;
  const entry = `UUID=${uuid} ${target} ntfs3 ${options} 0 0`;
  const fstab = fs.readFileSync('/etc/fstab', 'utf8');
  const entries = fstab.split('\n').filter(line => line.trim() && !line.trimStart().startsWith('#')).map(line => line.trim().split(/\s+/));
  const existing = entries.filter(fields => fields[1] === target);
  if (existing.length > 1 || (existing.length === 1 && existing[0].join(' ') !== entry)) throw new Error('A different media fstab entry already exists; refusing to overwrite it.');
  if (entries.some(fields => fields[0].toUpperCase() === `UUID=${uuid}`.toUpperCase() && fields[1] !== target)) throw new Error('This volume already has another fstab mount; refusing to add a competing entry.');
  console.log(`${check ? 'Proposed' : 'Media'} boot mount: ${entry}`);
  if (!check) {
    if (mountedUuid === undefined) run('mount', ['-t', 'ntfs3', '-o', `uid=${uid},gid=${gid},umask=0022`, `/dev/disk/by-uuid/${uuid}`, target]);
    if (!fs.statSync(`${target}/LKP`).isDirectory()) throw new Error('The mounted volume does not contain the expected LKP library.');
    if (!existing.length) {
      const mode = fs.statSync('/etc/fstab').mode & 0o777;
      const backup = `/etc/fstab.lkp-media-${Date.now()}`;
      const temporary = `/etc/.lkp-fstab-${process.pid}`;
      fs.copyFileSync('/etc/fstab', backup, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(backup, mode);
      try {
        const fd = fs.openSync(temporary, 'wx', mode);
        try {
          fs.writeFileSync(fd, `${fstab}${fstab.endsWith('\n') ? '' : '\n'}\n# LKP external media: absent drive must not prevent boot.\n${entry}\n`);
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, '/etc/fstab');
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      console.log(`Saved fstab backup: ${backup}`);
    }
    run('systemctl', ['daemon-reload']);
    console.log('Media drive mounted; boot mount configured. The existing acquisition timer will resume automatically.');
  }
} catch (error) {
  // Never print full configuration files or subprocess output.
  console.error(`Media mount setup failed: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`);
  process.exitCode = 1;
}
