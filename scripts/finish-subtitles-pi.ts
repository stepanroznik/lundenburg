// Detached preparation/activation job. The user authorized interrupting this
// test broadcaster; preserve its actual output flags instead of inferring RF.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import { acquireWeatherLock } from '../src/weather/lock.js';
import { LkpDatabase } from '../src/database.js';

const config = loadConfig();
const logRoot = path.join(config.storage.runtimeDirectory, 'maintenance');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const unlock = acquireWeatherLock(path.join(logRoot, 'subtitle-preparation.lock'));
async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: config.projectRoot, stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)));
  });
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
try {
  // Prepare the on-air asset before activation, including shifted test clocks.
  const activeFile = path.join(config.storage.runtimeDirectory, 'playout-status.json');
  if (fs.existsSync(activeFile)) {
    const active = JSON.parse(fs.readFileSync(activeFile, 'utf8')) as { current?: { scheduleEntryId: string } };
    if (active.current) {
      const db = new LkpDatabase(config.storage.database);
      try {
        const id = active.current.scheduleEntryId.split(':')[0];
        const row = db.listSchedule(Date.now() - 86400000, Date.now() + 7 * 86400000).find(entry => entry.id === id);
        if (row && db.listMedia().some(media => media.id === row.mediaId)) await run('npm', ['run', 'subtitles:prepare', '--', '--id', row.mediaId]);
      } finally { db.close(); }
    }
  }
  await run('npm', ['run', 'subtitles:prepare', '--', '--weather-only']);
  const statusFile = path.join(config.storage.runtimeDirectory, 'playout-status.json');
  if (fs.existsSync(statusFile)) {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as { state: string; pid: number; updatedAtMs: number };
    if (status.state === 'running' && alive(status.pid) && Date.now() - status.updatedAtMs < 15000) {
      const args = fs.readFileSync(`/proc/${status.pid}/cmdline`, 'utf8').split('\0');
      if (!args.includes('src/cli.ts') || !args.includes('broadcast') || !args.includes('start')) throw new Error('Current process is not the expected test broadcaster');
      const options: string[] = [];
      for (const flag of ['--rf', '--i-understand-rf', '--verbose']) if (args.includes(flag)) options.push(flag);
      for (const flag of ['--mode', '--gain', '--past-hours', '--past-minutes', '--future-hours', '--future-minutes']) {
        const index = args.indexOf(flag);
        if (index >= 0) options.push(flag, args[index + 1]!);
      }
      const childrenFile = `/proc/${status.pid}/task/${status.pid}/children`;
      const children = fs.readFileSync(childrenFile, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
      process.kill(status.pid, 'SIGINT');
      for (let i = 0; i < 10 && alive(status.pid); i++) await sleep(1000);
      // Old TSDuck/relay shutdown can leave pipes open. Only touch children
      // captured from this exact broadcaster, then retire its parent.
      if (alive(status.pid)) {
        for (const pid of children) if (alive(pid)) process.kill(pid, 'SIGKILL');
        if (alive(status.pid)) process.kill(status.pid, 'SIGKILL');
      }
      const log = fs.openSync(path.join(logRoot, 'broadcast-subtitles.log'), 'a');
      const child = spawn('npm', ['run', 'lkp', '--', 'broadcast', 'start', ...options], { cwd: config.projectRoot, detached: true, stdio: ['ignore', log, log] });
      child.unref(); fs.closeSync(log);
      let restarted = false;
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const next = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as typeof status;
        if (next.pid !== status.pid && next.state === 'running' && Date.now() - next.updatedAtMs < 5000) { restarted = true; break; }
      }
      if (!restarted) throw new Error('Broadcaster did not restart; inspect broadcast-subtitles.log');
      console.log(`${new Date().toISOString()} ACTIVE: selectable DVB subtitle support loaded`);
    }
  }
  await run('npm', ['run', 'subtitles:prepare']);
  console.log(`${new Date().toISOString()} COMPLETE: available library/weather captions prepared and decoded successfully`);
} catch (error) {
  console.error(`${new Date().toISOString()} FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally { unlock(); }
