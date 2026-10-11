import fs from 'node:fs';
import path from 'node:path';

export const recycledExclusion = 'Recycled content forbidden';
/** Metadata signals, not claims of verified footage overlap. */
export function recycledContent(value: { classification?: { contentType?: string; duplicateAssessment?: string }; compilation?: boolean; components?: unknown[] }): boolean {
  return value.compilation === true || Boolean(value.components?.length) ||
    ['compilation', 'recap'].includes(value.classification?.contentType ?? '') ||
    ['probable-repackaging', 'explicit-bundle'].includes(value.classification?.duplicateAssessment ?? '');
}

/** Called under the existing worker lease. Retire catalogue/schedule first;
 * delete only owned acquisition directories with no remaining playout reference.
 * Protected assets stay pending and are retried by later automatic batches. */
export async function purgeRecycled(service: any): Promise<{ removed: number; bytes: number; pending: number }> {
  const result = { removed: 0, bytes: 0, pending: 0 };
  const rows = service.store.candidates().filter((row: any) => service.sub(row.metadata.showId)?.forbidRecycledContent && recycledContent(row.metadata));
  if (!rows.length) return result;
  const media = service.db.listMedia(false);
  const files = service.store.files();
  // A duplicate candidate can point to an original episode. Retire the asset
  // only when its own provenance/assessment identifies it as the recycled upload.
  const retiring = new Set(media.filter((item: any) => service.sub(item.showId)?.forbidRecycledContent &&
    (recycledContent(item.technical.acquisition ?? {}) || rows.some((row: any) => row.catalogueId === item.id &&
      item.technical.acquisition?.sourceId === row.metadata.sourceId))).map((item: any) => item.id));
  service.guard.check();
  if (media.some((item: any) => retiring.has(item.id) && item.enabled))
    await service.db.db.backup(`${service.app.storage.database}.before-recycled-cleanup.sqlite`);
  service.db.db.transaction(() => {
    for (const item of media.filter((item: any) => retiring.has(item.id) && item.enabled)) {
      const warnings = JSON.stringify([...(item.qcWarnings ?? []), recycledExclusion]);
      service.db.db.prepare("UPDATE media_items SET enabled=0,ingest_state='review',qc_warnings_json=? WHERE id=?").run(warnings, item.id);
      service.db.db.prepare("UPDATE media_assets SET enabled=0,ingest_state='review',qc_warnings_json=? WHERE episode_id=?").run(warnings, item.id);
      service.store.set('schedule-dirty', '1');
    }
    for (const row of rows) service.store.transition(row.id, 'rejected', recycledExclusion, 0, row.catalogueId);
  }).immediate();
  // Regeneration preserves current/preloaded entries and the existing guard
  // window. If it cannot complete, do not remove any media on disk.
  await service.regenerate();
  const root = fs.realpathSync(service.app.media.root);
  for (const row of rows) {
    if (!/^[a-z0-9-]+$/.test(row.metadata.showId) || !/^[a-f0-9]{24}$/.test(row.id)) continue;
    const dir = path.join(root, row.metadata.showId, 'acquired', row.id);
    const owned = files.filter((file: any) => file.catalogue_id === row.catalogueId && row.catalogueId && file.new_asset === 1);
    if (fs.existsSync(dir)) {
      // Validate ownership and exact directory identity. Never follow a symlink
      // or remove a manually supplied/original library directory.
      let managed = false;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'ingest.json'), 'utf8'));
        managed = fs.realpathSync(dir) === dir && manifest.candidate.sourceId === row.metadata.sourceId &&
          manifest.candidate.showId === row.metadata.showId && path.dirname(manifest.item.mediaPath) === dir &&
          (owned.some((file: any) => path.dirname(file.path) === dir) || manifest.item.id === row.catalogueId || !row.catalogueId);
        // An unexpected file may have been placed here manually; retain it for
        // review rather than treating every directory child as an acquired copy.
        managed = managed && fs.readdirSync(dir).every(name => ['ingest.json', 'show.yaml'].includes(name) ||
          /^episode(?:\.[a-z-]+)?\.(?:mp4|mkv|webm|mov|srt|ass|vtt|ttml|yaml)$/.test(name));
        const paths = owned.map((file: any) => file.path);
        paths.push(manifest.item.mediaPath);
        for (const file of paths) {
          service.guard.check(file);
          const referenced = service.db.db.prepare('SELECT 1 FROM schedule_entries WHERE ends_at_ms>? AND (media_path=? OR instr(playout_plan_json,?)>0) LIMIT 1').get(Date.now(), file, file);
          if (referenced) { managed = false; break; }
        }
      } catch { managed = false; }
      if (!managed) { result.pending++; continue; }
      const bytes = service.directoryBytes(dir);
      // Keep provenance until all payloads have been removed, so an interrupted
      // cleanup can validate and resume without leaving orphaned media behind.
      for (const name of fs.readdirSync(dir).filter(name => name !== 'ingest.json')) fs.rmSync(path.join(dir, name), { recursive: true });
      fs.unlinkSync(path.join(dir, 'ingest.json'));
      fs.rmdirSync(dir);
      result.removed++; result.bytes += bytes;
      for (const file of owned) service.store.file({ ...file, state: 'missing', size: 0 });
      service.store.event(row.id, 'recycled-removed', recycledExclusion);
    } else {
      for (const file of owned) if (!fs.existsSync(file.path)) service.store.file({ ...file, state: 'missing', size: 0 });
    }
    const staged = path.join(service.root, 'staging', row.id);
    if (fs.existsSync(staged)) {
      try {
        service.guard.check();
        if (fs.realpathSync(staged) !== staged) { result.pending++; continue; }
        result.bytes += service.directoryBytes(staged);
        fs.rmSync(staged, { recursive: true });
      } catch { result.pending++; }
    }
  }
  service.store.set('recycled-cleanup', JSON.stringify({ ...result, at: Date.now() }));
  return result;
}
