import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const release = process.env.LKP_ACQUISITION_RELEASE;
async function fixture() {
  const load = name => import(pathToFileURL(path.join(release, `dist/src/${name}.js`)));
  const [{ ContentAcquisition }, { loadAcquisitionConfig, admission }, { LkpDatabase }, { stableId }, { purgeRecycled }, { buildScheduleEntries }, { Deferred }, { config, item }] = await Promise.all([
    load('acquisition/service'), load('acquisition/model'), load('database'), load('util'), load('acquisition/recycled'), load('schedule'), load('acquisition/io'),
    import(pathToFileURL(path.join(release, 'dist/test/helpers.js'))),
  ]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-no-recycling-')), app = config(root);
  fs.mkdirSync(app.media.root, { recursive: true });
  const policy = loadAcquisitionConfig(app, path.join(release, 'config/content-acquisition.yaml'));
  const db = new LkpDatabase(app.storage.database), service = new ContentAcquisition(app, db, policy);
  service.dirs(); service.store.set('inventory-complete', '1');
  const classification = { rank: 'A+', contentType: 'compilation', duplicateAssessment: 'no-evidence', title: 'Lernen', descriptionDe: 'Wir lernen.', reason: 'fixture', topics: [], seasonalTags: [] };
  const candidate = { showId: 'ms-rachel', source: 'youtube', sourceId: 'recycled-01', sourceUrl: 'https://www.youtube.com/watch?v=recycled-01', title: 'Learning bundle', description: '', language: 'en', durationMs: 600000, size: 100, available: true, components: [], compilation: false, classification };
  const id = service.store.remember(candidate), dir = path.join(app.media.root, candidate.showId, 'acquired', id);
  fs.mkdirSync(dir, { recursive: true });
  const recycled = { ...item(candidate.showId, 1, 600000), id: stableId('content', id), audioLanguage: 'en', defaultLanguage: 'en', mediaPath: path.join(dir, 'episode.mkv'), technical: { acquisition: { sourceId: candidate.sourceId, classification } } };
  const original = { ...item(candidate.showId, 2, 600000), audioLanguage: 'en', defaultLanguage: 'en', mediaPath: path.join(app.media.root, 'original.mkv'), technical: { acquisition: { sourceId: 'original-01', classification: { ...classification, contentType: 'episode' } } } };
  fs.writeFileSync(recycled.mediaPath, 'recycled'); fs.writeFileSync(original.mediaPath, 'original');
  fs.writeFileSync(path.join(dir, 'ingest.json'), JSON.stringify({ candidate, item: recycled }));
  db.upsertMedia([recycled, original]);
  service.store.file({ path: recycled.mediaPath, size: 8, mtime: fs.statSync(recycled.mediaPath).mtimeMs, show_id: candidate.showId, language: 'en', keys_json: '[]', catalogue_id: recycled.id, state: 'indexed', new_asset: 1 });
  service.store.transition(id, 'imported', '', 0, recycled.id);
  // Preserve an old future plan to verify removal precedes filesystem deletion.
  const startsAt = Date.now() + 3600000;
  db.insertSchedule(buildScheduleEntries([recycled, original], 'fixture', startsAt, startsAt + 3600000));
  // The stricter scheduler already excludes compilation metadata; inject one
  // historical scheduled reference as if written by the previous release.
  db.db.prepare('UPDATE schedule_entries SET media_id=?,media_path=? WHERE sequence=(SELECT MIN(sequence) FROM schedule_entries)').run(recycled.id, recycled.mediaPath);
  return { root, app, policy, db, service, candidate, id, dir, recycled, original, admission, purgeRecycled, Deferred,
    close() { db.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('recycled acquisition signals override A+, while original lessons stay eligible', { skip: !release }, async () => {
  const f = await fixture();
  try {
    const sub = f.policy.subscriptions.find(s => s.id === 'ms-rachel'), usage = { bytes: 0, durationMs: 0, episodes: 0 };
    assert.equal(sub.allowCompilations, false); assert.equal(sub.forbidRecycledContent, true);
    for (const overrides of [
      { classification: { ...f.candidate.classification, contentType: 'recap' } },
      { classification: { ...f.candidate.classification, contentType: 'episode', duplicateAssessment: 'probable-repackaging' } },
      { classification: { ...f.candidate.classification, contentType: 'episode', duplicateAssessment: 'explicit-bundle' } },
      { classification: { ...f.candidate.classification, contentType: 'episode' }, compilation: true },
      { classification: { ...f.candidate.classification, contentType: 'episode' }, components: ['original-episode'] },
      {},
    ]) assert.equal(f.admission({ ...f.candidate, ...overrides }, sub, usage, 0, f.policy), 'Recycled content forbidden');
    assert.equal(f.admission({ ...f.candidate, classification: { ...f.candidate.classification, contentType: 'episode' } }, sub, usage, 0, f.policy), undefined);
    assert.throws(() => f.service.commit(f.dir, f.id), /Recycled content forbidden/);
  } finally { f.close(); }
});

test('cleanup rebuilds old future plans before removing owned media, preserves originals and is idempotent', { skip: !release }, async () => {
  const f = await fixture();
  try {
    const regenerate = f.service.regenerate.bind(f.service);
    f.service.regenerate = async () => {};
    const pending = await f.purgeRecycled(f.service);
    assert.equal(pending.pending, 1); assert.ok(fs.existsSync(f.recycled.mediaPath));
    assert.equal(f.db.listMedia(false).find(i => i.id === f.recycled.id).enabled, false);
    f.service.regenerate = regenerate;
    const removed = await f.purgeRecycled(f.service);
    assert.equal(removed.removed, 1); assert.equal(removed.pending, 0); assert.ok(removed.bytes >= 8);
    assert.equal(fs.existsSync(f.dir), false); assert.ok(fs.existsSync(f.original.mediaPath));
    assert.ok(f.db.listMedia().some(i => i.id === f.original.id));
    assert.equal(f.db.db.prepare('SELECT COUNT(*) n FROM schedule_entries WHERE ends_at_ms>? AND media_path=?').get(Date.now(), f.recycled.mediaPath).n, 0);
    assert.equal(f.service.store.candidates().find(r => r.id === f.id).state, 'rejected');
    assert.equal(f.service.store.files().find(r => r.path === f.recycled.mediaPath).state, 'missing');
    assert.equal((await f.purgeRecycled(f.service)).removed, 0);
    assert.ok(fs.existsSync(`${f.app.storage.database}.before-recycled-cleanup.sqlite`));
  } finally { f.close(); }
});

test('protected assets remain on disk until safe, with later automatic cleanup', { skip: !release }, async () => {
  const f = await fixture();
  try {
    const guard = f.service.guard.check.bind(f.service.guard); let protectedAsset = true;
    f.service.guard.check = file => { if (file === f.recycled.mediaPath && protectedAsset) throw new f.Deferred('Active/preloaded asset'); guard(file); };
    assert.equal((await f.purgeRecycled(f.service)).pending, 1);
    assert.ok(fs.existsSync(f.recycled.mediaPath));
    protectedAsset = false;
    assert.equal((await f.purgeRecycled(f.service)).removed, 1);
    assert.ok(fs.existsSync(f.original.mediaPath));
  } finally { f.close(); }
});

test('cleanup never follows acquired-directory symlinks or retires an original targeted by a duplicate candidate', { skip: !release }, async () => {
  const f = await fixture();
  try {
    const moved = path.join(f.root, 'outside-acquisition'); fs.renameSync(f.dir, moved); fs.symlinkSync(moved, f.dir);
    assert.equal((await f.purgeRecycled(f.service)).pending, 1);
    assert.ok(fs.existsSync(path.join(moved, 'episode.mkv')));
    const duplicate = f.service.store.remember({ ...f.candidate, sourceId: 'duplicate-1', sourceUrl: 'https://www.youtube.com/watch?v=duplicate-1' });
    f.service.store.transition(duplicate, 'duplicate', '', 0, f.original.id);
    await f.purgeRecycled(f.service);
    assert.ok(f.db.listMedia().some(i => i.id === f.original.id)); assert.ok(fs.existsSync(f.original.mediaPath));
  } finally { f.close(); }
});

test('unexpected manual files are retained and interrupted payload removal keeps recovery provenance', { skip: !release }, async () => {
  const f = await fixture(); const remove = fs.rmSync;
  try {
    const manual = path.join(f.dir, 'manual-original.mp4'); fs.writeFileSync(manual, 'original');
    assert.equal((await f.purgeRecycled(f.service)).pending, 1);
    assert.ok(fs.existsSync(manual)); assert.ok(fs.existsSync(f.recycled.mediaPath));
    fs.unlinkSync(manual);
    const sidecar = path.join(f.dir, 'show.yaml'); fs.writeFileSync(sidecar, 'id: ms-rachel');
    fs.rmSync = (file, options) => { if (file === sidecar) throw new Error('fixture interruption'); return remove(file, options); };
    await assert.rejects(f.purgeRecycled(f.service), /fixture interruption/);
    assert.ok(fs.existsSync(path.join(f.dir, 'ingest.json')));
    fs.rmSync = remove;
    assert.equal((await f.purgeRecycled(f.service)).removed, 1);
    assert.ok(fs.existsSync(f.original.mediaPath));
  } finally { fs.rmSync = remove; f.close(); }
});
