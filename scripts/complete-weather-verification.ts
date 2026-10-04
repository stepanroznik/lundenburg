// Background follow-through for the explicitly requested live generation check.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { DateTime } from 'luxon';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const day = DateTime.now().setZone(config.channel.timezone).toISODate()!;
const root = path.join(config.media.generatedRoot, 'lkp-wetterfreunde', 'episodes', day);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const db = new Database(config.storage.database, { readonly: true });
const scheduled = (edition: string) => db.prepare('SELECT id FROM schedule_entries WHERE media_id=?').get(`weather-${day}-${edition}`);
function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, WEATHER_RENDER_CONCURRENCY: '1' } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)));
  });
}
try {
  console.log(`${new Date().toISOString()} Waiting for the in-progress morning render`);
  const deadline = Date.now() + 90 * 60000;
  while (!scheduled('morning')) {
    const failure = path.join(root, 'morning', 'failure.json');
    if (fs.existsSync(failure)) throw new Error(`Morning generation failed; inspect ${failure}`);
    if (Date.now() >= deadline) throw new Error('Morning render did not publish within 90 minutes');
    await sleep(15000);
  }
  await run('node', ['--import', 'tsx', 'scripts/verify-weather-schedule.ts'], config.projectRoot);
  if (!scheduled('afternoon')) {
    const window = DateTime.now().setZone(config.channel.timezone).startOf('day').set({ hour: 13 });
    const boundary = db.prepare('SELECT starts_at_ms FROM schedule_entries WHERE starts_at_ms>=? ORDER BY starts_at_ms LIMIT 1').get(window.toMillis()) as { starts_at_ms: number } | undefined;
    if (!boundary) throw new Error('No afternoon boundary');
    // Fetch within two hours of the complete film, with ten minutes of margin.
    const delay = boundary.starts_at_ms + 10 * 60000 - 120 * 60000 - Date.now();
    if (delay > 0) {
      console.log(`${new Date().toISOString()} Waiting ${Math.ceil(delay / 60000)} minutes for afternoon forecast freshness`);
      await sleep(delay);
    }
    if (!scheduled('afternoon')) {
      console.log(`${new Date().toISOString()} Generating afternoon weather on the external drive`);
      await run('nice', ['-n', '19', 'taskset', '-c', '0,1', 'npm', 'run', 'weather:generate', '--', '--edition', 'afternoon', '--at', new Date(boundary.starts_at_ms).toISOString(), '--publish'], '/home/lundenburg/lkp-weather');
    }
  }
  await run('node', ['--import', 'tsx', 'scripts/verify-weather-schedule.ts'], config.projectRoot);
  await run('tstabcomp', ['--compile', config.epg.output, '--output', 'runtime/maintenance/epg-verified.bin'], config.projectRoot);
  console.log(`${new Date().toISOString()} COMPLETE: morning and afternoon published; media, validity, schedule and EPG verified`);
} catch (error) {
  console.error(`${new Date().toISOString()} FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  db.close();
}
