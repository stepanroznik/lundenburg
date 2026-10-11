// One-time maintenance using the deployed acquisition pipeline. The recurring
// worker remains responsible for all subsequent discovery and acquisition.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
const release = fs.realpathSync(option('--release'));
const snapshot = args.includes('--snapshot') ? path.resolve(option('--snapshot')) : undefined;
const apply = args.includes('--apply') ? path.resolve(option('--apply')) : undefined;
if (Boolean(snapshot) === Boolean(apply)) throw Error('Choose --snapshot FILE or --apply FILE');
const load = name => import(pathToFileURL(path.join(release, `dist/src/${name}.js`)));
const [{ loadConfig }, { loadAcquisitionConfig }, { LkpDatabase }, { ContentAcquisition }, classification, { execute }, { fetchText }, { credential }, { extractorArgs }] = await Promise.all([
  load('config'), load('acquisition/model'), load('database'), load('acquisition/service'), load('acquisition/classification'), load('acquisition/io'), load('acquisition/sources'), load('acquisition/enrichment'), load('acquisition/adapters'),
]);
const app = loadConfig(path.join(release, 'config/lkp.yaml')), policy = loadAcquisitionConfig(app);
const subscriptions = policy.subscriptions.filter(s => s.editorialClassification);
if (snapshot) {
  if (fs.existsSync(snapshot) && !args.includes('--resume')) throw Error('Snapshot destination already exists; use --resume to reuse decisions');
  if (!fs.existsSync(snapshot)) {
    const source = new Database(app.storage.database, { readonly: true, fileMustExist: true });
    try { await source.backup(snapshot); fs.chmodSync(snapshot, 0o600); } finally { source.close(); }
  }
  app.storage.database = snapshot;
}
const db = new LkpDatabase(app.storage.database), service = new ContentAcquisition(app, db, policy);
const owner = `${process.pid}:educational-bootstrap`;
let leased = false, renew;
const summary = () => subscriptions.map(s => {
  const rows = service.store.candidates().filter(r => r.metadata.showId === s.id);
  return { show: s.id, discovered: rows.length,
    ranks: Object.fromEntries(['A+', 'A', 'B', 'C', 'D', 'X', 'pending'].map(rank => [rank, rows.filter(r => (r.metadata.classification?.rank ?? 'pending') === rank).length])),
    imported: rows.filter(r => r.state === 'imported').length, rejected: rows.filter(r => r.state === 'rejected').length,
    descriptions: rows.filter(r => r.metadata.classification && r.metadata.classification.rank !== 'X').length,
    eligibleEstimatedBytes: rows.filter(r => classification.acquiredRank(r.metadata.classification?.rank)).reduce((n, r) => n + r.metadata.size, 0),
    acquisitionQueue: rows.filter(r => classification.acquiredRank(r.metadata.classification?.rank) && !['imported', 'duplicate'].includes(r.state)).length,
    usage: service.usage(s.id) };
});
try {
  if (!snapshot) {
    if (!service.store.acquire(owner, 3000000)) throw Error('ACQUISITION_BUSY');
    leased = true;
    renew = setInterval(() => service.store.renew(owner, 3000000), 20000);
  }
  service.batchDeadline = Date.now() + policy.maxRunSeconds * 1000;
  if (snapshot) {
    for (const s of subscriptions) {
      const candidates = JSON.parse(fs.readFileSync(path.join(option('--inventory-dir') ?? '/tmp', `lkp-${s.id}-inventory.json`), 'utf8'));
      for (const c of candidates) {
        if (c.source !== 'youtube' || c.showId !== s.id || !/^[\w-]{11}$/.test(c.sourceId) || c.sourceUrl !== `https://www.youtube.com/watch?v=${c.sourceId}`) throw Error('Invalid reviewed inventory');
        service.store.remember(c);
      }
    }
    let count;
    do {
      count = await classification.classifyPending(service, { execute, request: fetchText, credential, extractorArgs });
      console.log(JSON.stringify({ classified: count, summary: summary() }));
    } while (count && Date.now() < service.batchDeadline && summary().some(s => s.ranks.pending));
  } else {
    const source = new Database(apply, { readonly: true, fileMustExist: true });
    try {
      const classifier = new classification.EducationalClassifier(db.db);
      db.db.transaction(() => {
        for (const row of source.prepare('SELECT metadata_json FROM acquisition_candidates').all()) {
          const c = JSON.parse(row.metadata_json);
          if (!subscriptions.some(s => s.id === c.showId)) continue;
          const saved = source.prepare('SELECT * FROM acquisition_classifications WHERE source_id=? ORDER BY classified_at,prompt_version LIMIT 1').get(c.sourceId);
          if (saved) db.db.prepare('INSERT OR IGNORE INTO acquisition_classifications VALUES(?,?,?,?,?)').run(saved.source_id, saved.prompt_version, saved.result_json, saved.model, saved.classified_at);
          const result = classifier.cached(c.sourceId);
          if (result) classification.applyClassification(c, result, classifier.model(c.sourceId), classifier.version(c.sourceId));
          const id = service.store.remember(c);
          const metadata = source.prepare('SELECT value FROM acquisition_state WHERE key=?').get(`youtube-metadata-v1:${c.sourceId}`);
          if (metadata) service.store.set(`youtube-metadata-v1:${c.sourceId}`, metadata.value);
          const existing = service.store.candidates().find(r => r.id === id);
          if (result && !classification.acquiredRank(result.rank) && !['imported', 'duplicate'].includes(existing.state)) service.store.transition(id, 'rejected', `Editorial ${result.rank}: ${result.reason}`);
        }
      }).immediate();
    } finally { source.close(); }
    service.dirs();
    if (args.includes('--acquire-initial')) {
      let imported = 0;
      // A small validation batch, selecting the best-ranked shortest candidate per show.
      for (const s of subscriptions) {
        const row = service.store.candidates(['discovered', 'deferred', 'bounded']).filter(r => r.metadata.showId === s.id &&
          classification.acquiredRank(r.metadata.classification?.rank) && r.retryAt <= Date.now() && !service.budget(r.metadata, s))
          .sort((a, b) => classification.rankPriority(b.metadata.classification.rank) - classification.rankPriority(a.metadata.classification.rank) || a.metadata.durationMs - b.metadata.durationMs)[0];
        if (!row) continue;
        console.log(JSON.stringify({ acquiring: s.id, sourceId: row.metadata.sourceId, rank: row.metadata.classification.rank }));
        try { await service.ingest(row); imported++; }
        catch { service.store.transition(row.id, 'deferred', 'Initial acquisition unavailable; recurring worker will retry', Date.now() + 1800000); }
      }
      if (imported) await service.regenerate();
    }
    service.store.set('next-automatic-run', String(Date.now() + 60000));
    console.log(JSON.stringify({ summary: summary() }));
  }
} catch (error) {
  console.error(error.message === 'ACQUISITION_BUSY' ? 'Acquisition lease is busy; retry after the current batch.' : 'Educational bootstrap could not complete; persistent decisions retained for retry.');
  process.exitCode = 1;
} finally {
  clearInterval(renew);
  if (leased) service.store.release(owner);
  db.close();
}
