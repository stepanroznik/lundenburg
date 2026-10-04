import fs from 'node:fs';
import path from 'node:path';

export interface PlayoutStatus {
  version: 1;
  state: 'running' | 'stopped';
  updatedAtMs: number;
  pid: number;
  leadMs: number;
  driftMs: number;
  direction: 'ahead' | 'behind' | 'on-time';
  current: { scheduleEntryId: string; title: string; actualStartMs: number; plannedStartMs: number } | null;
  next: { scheduleEntryId: string; title: string; ready: boolean } | null;
}

export function writePlayoutStatus(file: string, status: PlayoutStatus): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(status)}\n`, { mode: 0o640 });
  fs.renameSync(temporary, file);
}

export function readPlayoutStatus(file: string, nowMs = Date.now()): (PlayoutStatus & { stale: boolean }) | null {
  try {
    const status = JSON.parse(fs.readFileSync(file, 'utf8')) as PlayoutStatus;
    if (status.version !== 1 || !['running', 'stopped'].includes(status.state) ||
      !Number.isFinite(status.updatedAtMs) || !Number.isFinite(status.leadMs)) return null;
    return { ...status, stale: status.state === 'running' && nowMs - status.updatedAtMs > 5000 };
  } catch { return null; }
}

export function timingLabel(status: Pick<PlayoutStatus, 'leadMs'>): string {
  if (Math.abs(status.leadMs) < 250) return 'On schedule';
  return `${(Math.abs(status.leadMs) / 1000).toFixed(1)} s ${status.leadMs > 0 ? 'ahead of' : 'behind'} schedule`;
}
