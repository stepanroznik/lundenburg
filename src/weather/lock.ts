import fs from 'node:fs';
import crypto from 'node:crypto';

function identity(pid: number): string | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    return `${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${start}`;
  } catch { return undefined; }
}
// Recover a lock after a killed render or a Pi reboot without stealing it from
// a live process. Boot ID + process start time also handles PID reuse.
export function acquireWeatherLock(file: string): () => void {
  const owner = { pid: process.pid, identity: identity(process.pid), token: crypto.randomUUID() };
  if (fs.existsSync(file)) {
    let previous: typeof owner;
    try { previous = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof owner; }
    catch { throw new Error(`Unrecognized legacy lock ${file}; confirm the old generator has stopped before removing it`); }
    if (!previous.identity || previous.identity === identity(previous.pid)) throw new Error(`Weather generation already owns ${file}`);
    fs.unlinkSync(file);
  }
  fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  return () => {
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).token === owner.token) fs.unlinkSync(file);
  };
}
