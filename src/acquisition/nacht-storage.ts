import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import type { AppConfig, MediaItem } from '../types.js';
import { mediaPolicy } from '../channels.js';
import type { AcquisitionStore } from './store.js';
import type { Candidate, Subscription } from './model.js';
import { Deferred } from './io.js';
import { readPlayoutStatus } from '../playout-status.js';

export function directoryBytes(root: string): number {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, e.name);
    if (e.isDirectory()) total += directoryBytes(file);
    else if (e.isFile()) total += fs.statSync(file).size;
  }
  return total;
}

/** Works inside the existing acquisition lease, catalogue and guarded future rebuild. */
export class NachtStorage {
  constructor(private app: AppConfig, private store: AcquisitionStore, private subscriptions: Subscription[]) {
    store.catalogue.db.exec(`CREATE TABLE IF NOT EXISTS latest_programmes (
      show_id TEXT PRIMARY KEY,media_id TEXT NOT NULL,published_at_ms INTEGER NOT NULL,registered_at_ms INTEGER NOT NULL)`);
  }
  report(): { bytes: number; stagingBytes: number; maxBytes: number; freeBytes: number; reserveBytes: number; deficitBytes: number; sources: Record<string, number> } {
    const sources: Record<string, number> = {};
    const owned = this.store.catalogue.listMedia(false).filter(m => {
      const p = mediaPolicy(m, this.app.station); return p.profiles.includes('ln') && !p.profiles.includes('lkp');
    });
    const sourceIds = new Set([...this.subscriptions.filter(s => s.profile === 'ln').map(s => s.id), ...owned.map(m => m.showId)]);
    let bytes = 0, stagingBytes = 0;
    for (const id of sourceIds) {
      const folder = path.join(this.app.media.root, id);
      const total = directoryBytes(folder);
      sources[id] = total; bytes += total;
    }
    // Existing manually catalogued LN-only files may be in a differently named folder.
    for (const m of owned) if (!sourceIds.has(path.relative(this.app.media.root, m.mediaPath).split(path.sep)[0]!) && fs.existsSync(m.mediaPath)) {
      const size = fs.statSync(m.mediaPath).size; bytes += size; sources[m.showId] = (sources[m.showId] ?? 0) + size;
    }
    for (const row of this.store.candidates()) if (sourceIds.has(row.metadata.showId)) {
      for (const area of ['staging', 'quarantine']) stagingBytes += directoryBytes(path.join(this.app.media.root, '.acquisition', area, row.id));
    }
    const incoming = path.join(this.app.media.root, '.acquisition/incoming');
    if (fs.existsSync(incoming)) for (const entry of fs.readdirSync(incoming, { withFileTypes: true })) {
      if (![...sourceIds].some(id => entry.name === id || entry.name.startsWith(`${id}__`))) continue;
      const file = path.join(incoming, entry.name); stagingBytes += entry.isDirectory() ? directoryBytes(file) : fs.statSync(file).size;
    }
    bytes += stagingBytes;
    const stat = fs.statfsSync(this.app.media.root), freeBytes = stat.bavail * stat.bsize;
    const cap = this.app.station?.storage;
    return { bytes, stagingBytes, maxBytes: cap?.maxBytes ?? 0, freeBytes, reserveBytes: cap?.reserveBytes ?? 0,
      deficitBytes: Math.max(0, bytes - (cap?.maxBytes ?? 0)), sources };
  }
  assertAdmission(requiredBytes: number): void {
    const r = this.report();
    if (!Number.isFinite(requiredBytes) || requiredBytes < 0 || r.bytes + requiredBytes > r.maxBytes)
      throw new Deferred('LN library storage cap reached; protected collection retained');
    if (r.freeBytes - requiredBytes < r.reserveBytes) throw new Deferred('LN filesystem reserve would be breached');
  }
  /** Swap the catalogue reference inside the same transaction as successful ingest. */
  registerLatest(item: MediaItem, c: Candidate): void {
    if (mediaPolicy(item, this.app.station).retention !== 'latest-only') return;
    const db = this.store.catalogue;
    const old = db.db.prepare('SELECT media_id,published_at_ms FROM latest_programmes WHERE show_id=?').get(item.showId) as { media_id: string; published_at_ms: number } | undefined;
    if (old && old.media_id !== item.id && old.published_at_ms >= (c.publishedAt ?? 0)) {
      db.db.prepare('UPDATE media_items SET enabled=0 WHERE id=?').run(item.id);
      db.db.prepare('UPDATE media_assets SET enabled=0 WHERE id=?').run(item.id);
      return;
    }
    db.db.prepare('INSERT INTO latest_programmes VALUES(?,?,?,?) ON CONFLICT(show_id) DO UPDATE SET media_id=excluded.media_id,published_at_ms=excluded.published_at_ms,registered_at_ms=excluded.registered_at_ms')
      .run(item.showId, item.id, c.publishedAt ?? 0, Date.now());
    db.db.prepare('UPDATE media_items SET enabled=0 WHERE show_id=? AND id!=?').run(item.showId, item.id);
    db.db.prepare('UPDATE media_assets SET enabled=0 WHERE episode_id IN (SELECT id FROM episodes WHERE show_id=?) AND id!=?').run(item.showId, item.id);
  }
  private protected(item: MediaItem, now = Date.now()): boolean {
    const db = this.store.catalogue, p = mediaPolicy(item, this.app.station);
    if (p.pinned || p.retention === 'protected') return true;
    const latest = db.db.prepare('SELECT 1 FROM latest_programmes WHERE media_id=?').get(item.id);
    if (latest) return true;
    const horizon = now + (this.app.station?.storage.imminentMinutes ?? 30) * 60_000;
    const imminent = db.listSchedule(now - 60_000, horizon);
    const status = readPlayoutStatus(path.join(this.app.storage.runtimeDirectory, 'playout-status.json'));
    for (const id of [status?.current?.scheduleEntryId, status?.next?.scheduleEntryId]) {
      const e = id ? db.db.prepare('SELECT starts_at_ms,ends_at_ms FROM schedule_entries WHERE id=?').get(id.split(':')[0]!) as { starts_at_ms: number; ends_at_ms: number } | undefined : undefined;
      if (e) imminent.push(...db.listSchedule(e.starts_at_ms, e.ends_at_ms));
    }
    if (imminent.some(e => e.mediaPath === item.mediaPath || e.playoutPlan?.segments.some(s => s.mediaPath === item.mediaPath))) return true;
    return Boolean(db.db.prepare(`SELECT 1 FROM playback_media m JOIN playback_log l ON l.id=m.playback_id WHERE m.media_id=? AND l.status='started' AND l.actual_end_ms IS NULL`).get(item.id));
  }
  private disableSidecar(item: MediaItem): void {
    const sidecar = item.mediaPath.slice(0, -path.extname(item.mediaPath).length) + '.yaml';
    const previous = fs.existsSync(sidecar) ? parse(fs.readFileSync(sidecar, 'utf8')) : {};
    const temporary = `${sidecar}.retire.tmp`;
    fs.writeFileSync(temporary, stringify({ ...previous, enabled: false })); fs.renameSync(temporary, sidecar);
  }
  expire(): number {
    let count = 0;
    for (const item of this.store.catalogue.listMedia()) {
      const p = mediaPolicy(item, this.app.station);
      if (p.retention !== 'temporary' || !p.expiresAtMs || p.expiresAtMs > Date.now() || this.protected(item) || !this.ownedAcquisition(item)) continue;
      this.disableSidecar(item); this.store.catalogue.upsertMedia([{ ...item, enabled: false }]);
      const row = this.store.candidates().find(c => c.catalogueId === item.id);
      if (row) this.store.transition(row.id, 'evicted', 'Configured temporary retention expired; no automatic redownload');
      this.store.set('schedule-dirty', '1'); count++;
    }
    return count;
  }
  /** Choose ordinary material first; no protected asset is ever a quota victim. */
  async makeRoom(requiredBytes: number, rebuild: () => Promise<void>): Promise<void> {
    const db = this.store.catalogue;
    const r = this.report(), need = Math.max(r.bytes + requiredBytes - r.maxBytes, r.reserveBytes + requiredBytes - r.freeBytes, 0);
    if (!need) return;
    const plays = new Map((db.db.prepare('SELECT media_id,played_count,last_played_at_ms FROM media_rotation_history').all() as Array<{ media_id: string; played_count: number; last_played_at_ms: number }>).map(r => [r.media_id, r]));
    const choices = db.listMedia().filter(m => {
      const p = mediaPolicy(m, this.app.station);
      return p.profiles.length === 1 && p.profiles[0] === 'ln' && p.retention !== 'latest-only' && !this.protected(m) &&
        this.subscriptions.some(s => s.id === m.showId && s.profile === 'ln') && this.ownedAcquisition(m);
    }).sort((a, b) => {
      const pa = mediaPolicy(a, this.app.station), pb = mediaPolicy(b, this.app.station);
      const score = (m: MediaItem) => {
        const p = mediaPolicy(m, this.app.station), h = plays.get(m.id);
        return (p.expiresAtMs && p.expiresAtMs <= Date.now() ? -1e12 : 0) + p.priority * 1e8 +
          (h?.played_count ? h.last_played_at_ms / 1e4 : 1e11) +
          (db.listMedia().filter(o => o.showId === m.showId).length < 3 ? 1e10 : 0);
      };
      return score(a) - score(b) || pa.priority - pb.priority || a.id.localeCompare(b.id);
    });
    let freed = 0;
    for (const item of choices) {
      this.disableSidecar(item); db.upsertMedia([{ ...item, enabled: false }]);
      this.store.set('schedule-dirty', '1');
      const candidate = this.store.candidates().find(c => c.catalogueId === item.id);
      if (candidate) this.store.transition(candidate.id, 'evicted', 'Retired by LN storage policy; no automatic redownload');
      freed += fs.existsSync(item.mediaPath) ? fs.statSync(item.mediaPath).size : 0;
      if (freed >= need) break;
    }
    if (freed) { await rebuild(); this.cleanup(); }
    this.assertAdmission(requiredBytes);
  }
  private ownedAcquisition(m: MediaItem): boolean {
    const rel = path.relative(path.join(this.app.media.root, m.showId, 'acquired'), m.mediaPath);
    return !rel.startsWith('..') && !path.isAbsolute(rel) && rel.split(path.sep).length === 2;
  }
  cleanup(): number {
    const db = this.store.catalogue, future = db.listSchedule(Date.now(), Number.MAX_SAFE_INTEGER);
    const paths = new Set(future.flatMap(e => [e.mediaPath, ...(e.playoutPlan?.segments.map(s => s.mediaPath) ?? [])]));
    let removed = 0;
    for (const item of db.listMedia(false).filter(m => !m.enabled)) {
      if (!fs.existsSync(item.mediaPath)) continue;
      const p = mediaPolicy(item, this.app.station);
      if (!p.profiles.includes('ln') || p.profiles.includes('lkp') || !this.ownedAcquisition(item) || this.protected(item) || paths.has(item.mediaPath)) continue;
      const row = this.store.candidates().find(r => r.catalogueId === item.id);
      if (p.retention !== 'latest-only' && row?.state !== 'evicted') continue;
      // Keep IDs, metadata and failure/playback history in SQLite. Only owned media is removed.
      this.disableSidecar(item);
      for (const file of [item.mediaPath, ...item.subtitles.flatMap(s => s.path ? [s.path] : [])]) {
        if (path.dirname(file) === path.dirname(item.mediaPath)) fs.rmSync(file, { force: true });
      }
      db.db.prepare("UPDATE acquisition_files SET state='missing' WHERE catalogue_id=?").run(item.id); removed++;
    }
    return removed;
  }
}
