import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LkpDatabase } from '../database.js';
import type { ProbeResult } from '../media.js';
import { Deferred, Quarantined, signature, sameSignature } from './io.js';

interface Journal {
  operation: string; original: string; prepared: string; backup: string; catalogueId: string;
  oldSignature: { size: number; mtime: number }; newSignature: { size: number; mtime: number };
  technical: Record<string, unknown>;
}
const journalPath = (dir: string) => path.join(dir, 'swap.json');
function atomicJson(file: string, value: unknown): void {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  const fd = fs.openSync(`${file}.tmp`, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(`${file}.tmp`, file);
}
function validatePaths(original: string, dir: string): void {
  const episodeDir = path.dirname(original), id = path.basename(episodeDir);
  const mediaRoot = path.resolve(episodeDir, '../../..');
  if (path.basename(path.dirname(episodeDir)) !== 'acquired' ||
      path.resolve(dir) !== path.join(mediaRoot, '.acquisition/staging', `quality-${id}`) ||
      !/^episode\.(mp4|mkv|mov)$/.test(path.basename(original)))
    throw new Quarantined('Invalid quality replacement paths');
}
function updateManifest(db: LkpDatabase, journal: Journal): void {
  const file = path.join(path.dirname(journal.original), 'ingest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.item.id !== journal.catalogueId || manifest.item.mediaPath !== journal.original)
    throw new Quarantined('Replacement recovery identity mismatch');
  const row = db.db.prepare('SELECT technical_json FROM media_items WHERE id=?').get(journal.catalogueId) as { technical_json: string };
  manifest.item.technical = JSON.parse(row.technical_json);
  manifest.mediaSignature = signature(journal.original);
  atomicJson(file, manifest);
}

/** A crash before SQLite commit restores the old inode; a committed swap finishes cleanup. */
export function recoverQualityReplacement(db: LkpDatabase, original: string, dir: string, guard: () => void): boolean {
  validatePaths(original, dir);
  const file = journalPath(dir);
  if (!fs.existsSync(file)) return false;
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Journal;
  if (j.original !== original || j.backup !== path.join(dir, 'original.rollback') || path.dirname(j.prepared) !== dir)
    throw new Quarantined('Invalid replacement recovery journal');
  const row = db.db.prepare('SELECT media_path,technical_json FROM media_items WHERE id=?').get(j.catalogueId) as { media_path: string; technical_json: string } | undefined;
  if (row?.media_path !== original) throw new Quarantined('Replacement recovery catalogue mismatch');
  const technical = JSON.parse(row.technical_json);
  if (technical.qualityReplacement?.operation === j.operation) {
    if (!sameSignature(signature(original), j.newSignature)) throw new Quarantined('Committed replacement changed before recovery');
    updateManifest(db, j);
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
  guard();
  if (!fs.existsSync(j.backup) || !sameSignature(signature(j.backup), j.oldSignature))
    throw new Quarantined('Replacement rollback copy is missing or changed');
  if (sameSignature(signature(original), j.newSignature) && !fs.existsSync(j.prepared)) fs.linkSync(original, j.prepared);
  else if (!sameSignature(signature(original), j.oldSignature)) throw new Quarantined('Original changed during replacement recovery');
  fs.renameSync(j.backup, original);
  fs.unlinkSync(file);
  return false;
}

/** Replace one existing asset at the same path/ID. Schedule rows and sidecars are untouched. */
export function installQualityReplacement(options: {
  db: LkpDatabase; original: string; prepared: string; dir: string; sourceId: string;
  targetHeight: number; probe: ProbeResult; guard: () => void;
}): void {
  const { db, original, prepared, dir, sourceId, targetHeight, probe, guard } = options;
  validatePaths(original, dir);
  if (path.dirname(prepared) !== dir || path.extname(prepared) !== path.extname(original))
    throw new Quarantined('Prepared replacement must preserve the original container/path');
  if (recoverQualityReplacement(db, original, dir, guard)) return;
  const row = db.db.prepare('SELECT id,duration_ms,technical_json,subtitles_json FROM media_items WHERE media_path=?').get(original) as {
    id: string; duration_ms: number; technical_json: string; subtitles_json: string;
  } | undefined;
  if (!row) throw new Quarantined('Replacement asset is not in the catalogue');
  const technical = JSON.parse(row.technical_json);
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(original), 'ingest.json'), 'utf8'));
  if (technical.acquisition?.sourceId !== sourceId || manifest.candidate.sourceId !== sourceId || manifest.item.id !== row.id || manifest.item.mediaPath !== original)
    throw new Quarantined('Replacement source identity mismatch');
  const video = probe.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const duration = Number(probe.format.duration) * 1000;
  if (!Number.isInteger(targetHeight) || targetHeight < 480 || !video?.height || video.height < Math.max(480, targetHeight) || video.codec_name !== 'h264' ||
      !probe.streams.some(s => s.codec_type === 'audio') || !Number.isFinite(duration) || Math.abs(duration - row.duration_ms) > 2000)
    throw new Quarantined('Replacement resolution, codec, audio or duration validation failed');
  // Embedded caption indices must retain their meaning; sidecar captions are unchanged.
  for (const track of JSON.parse(row.subtitles_json) as Array<{ streamIndex?: number; kind: string; codec?: string }>) {
    if (track.kind === 'embedded' || track.kind === 'dvb-bitmap') {
      const stream = probe.streams.find(s => s.index === track.streamIndex);
      if (stream?.codec_type !== 'subtitle' || (track.codec && stream.codec_name !== track.codec))
        throw new Quarantined('Replacement would invalidate an embedded subtitle track');
    }
  }
  const backup = path.join(dir, 'original.rollback');
  if (fs.existsSync(backup)) {
    const a = fs.statSync(original), b = fs.statSync(backup);
    if (a.ino !== b.ino || a.dev !== b.dev) throw new Quarantined('Unresolved rollback copy');
    fs.unlinkSync(backup);
  }
  const operation = randomUUID();
  const nextTechnical = { ...technical, format: { ...probe.format, filename: original }, streams: probe.streams,
    qualityReplacement: { operation, sourceId, installedAt: Date.now(), width: video.width, height: video.height } };
  guard();
  const j: Journal = { operation, original, prepared, backup, catalogueId: row.id, oldSignature: signature(original), newSignature: signature(prepared), technical: nextTechnical };
  fs.linkSync(original, backup);
  atomicJson(journalPath(dir), j);
  try {
    db.db.transaction(() => {
      guard();
      if (!sameSignature(signature(original), j.oldSignature) || !sameSignature(signature(prepared), j.newSignature))
        throw new Deferred('Asset changed before atomic replacement');
      fs.renameSync(prepared, original);
      const encoded = JSON.stringify(nextTechnical);
      db.db.prepare('UPDATE media_items SET technical_json=?,scanned_at_ms=? WHERE id=?').run(encoded, Date.now(), row.id);
      db.db.prepare('UPDATE media_assets SET technical_json=? WHERE id=?').run(encoded, row.id);
      const stat = signature(original);
      db.db.prepare('UPDATE acquisition_files SET size=?,mtime=? WHERE path=?').run(stat.size, stat.mtime, original);
      db.db.prepare('DELETE FROM acquisition_probe_cache WHERE path=?').run(original);
    }).immediate();
  } catch (error) {
    recoverQualityReplacement(db, original, dir, guard);
    throw error;
  }
  updateManifest(db, j);
  fs.rmSync(dir, { recursive: true, force: true });
}
