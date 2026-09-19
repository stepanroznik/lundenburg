import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { AppConfig } from './types.js';
import { LkpDatabase } from './database.js';
import { generateEpgXml } from './epg.js';

export interface DoctorCheck { name: string; ok: boolean; detail: string; required: boolean }

function isFile(file: string): boolean {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function commandCheck(name: string, command: string, args: string[], required = true): DoctorCheck {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return { name, ok: !result.error && result.status === 0, detail: result.error?.message ?? (result.stdout || result.stderr).split('\n')[0]!.trim(), required };
}

export function runDoctor(db: LkpDatabase, config: AppConfig, rf: boolean): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push({ name: 'media root', ok: fs.existsSync(config.media.root), detail: config.media.root, required: true });
  checks.push({ name: 'database', ok: db.db.open, detail: config.storage.database, required: true });
  checks.push({ name: 'logo', ok: isFile(config.logo.path), detail: config.logo.path, required: true });
  checks.push(commandCheck('FFmpeg', 'ffmpeg', ['-version']));
  checks.push(commandCheck('ffprobe', config.media.ffprobe, ['-version']));
  checks.push(commandCheck('TSDuck', 'tsp', ['--version'], rf));
  checks.push(commandCheck('GNU Radio', 'gnuradio-config-info', ['--version'], rf));
  if (rf) checks.push(commandCheck('HackRF', 'hackrf_info', []));
  const current = db.currentAt(Date.now());
  checks.push({ name: 'schedule covers now', ok: Boolean(current), detail: current ? `${current.showTitle}: ${current.episodeTitle}` : 'Run media scan and schedule generate', required: true });
  const missing = db.listSchedule(Date.now(), Date.now() + config.schedule.epgDays * 86_400_000).filter((entry) => !isFile(entry.mediaPath));
  checks.push({ name: 'scheduled files', ok: missing.length === 0, detail: missing.length ? `${missing.length} missing file(s)` : 'all present', required: true });
  try {
    const xml = generateEpgXml(db.listSchedule(Date.now() - 86_400_000, Date.now() + config.schedule.epgDays * 86_400_000), config);
    checks.push({ name: 'EPG generation', ok: xml.includes('<EIT'), detail: `${Buffer.byteLength(xml)} bytes`, required: true });
  } catch (error) {
    checks.push({ name: 'EPG generation', ok: false, detail: String(error), required: true });
  }
  return checks;
}
