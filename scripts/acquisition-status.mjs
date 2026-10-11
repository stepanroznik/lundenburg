#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { safeText, renderReport } from './acquisition-report.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run acquisition -- [--watch] [--json] [--limit N]\nRead-only acquisition overview. --watch refreshes every 10 seconds; --limit controls upcoming/recent rows (default 5).');
  process.exit(0);
}
let limit = 5;
for (let i = 0; i < args.length; i++) {
  if (['--watch', '--json'].includes(args[i])) continue;
  if (args[i] === '--limit' && /^\d+$/.test(args[i + 1] ?? '')) { limit = Number(args[++i]); continue; }
  console.error('Unknown option; use --help.'); process.exit(1);
}
if (limit < 1 || limit > 100) { console.error('--limit must be between 1 and 100.'); process.exit(1); }

async function collect() {
  // Resolve on each refresh so a deployed acquisition fix is reflected immediately.
  const release = fs.realpathSync(process.env.LKP_ACQUISITION_RELEASE ?? '/home/lundenburg/lkp-content/current');
  const load = name => import(pathToFileURL(path.join(release, `dist/src/${name}.js`)));
  const [{ loadConfig }, { LkpDatabase }, { ContentAcquisition }, { AcquisitionStore }, { loadAcquisitionConfig, candidateScore }, { processAlive }, { usesStreamExtractor }] = await Promise.all([
    load('config'), load('database'), load('acquisition/service'), load('acquisition/store'), load('acquisition/model'), load('acquisition/io'), load('acquisition/adapters'),
  ]);
  const app = loadConfig(), config = loadAcquisitionConfig(app);
  const { rankPriority } = fs.existsSync(path.join(release, 'dist/src/acquisition/classification.js'))
    ? await load('acquisition/classification') : { rankPriority: () => 0 };
  const db = new Database(app.storage.database, { readonly: true, fileMustExist: true });
  try {
    // Bypass constructors which create tables or migrate the production database.
    const catalogue = Object.assign(Object.create(LkpDatabase.prototype), { db });
    const store = Object.assign(Object.create(AcquisitionStore.prototype), { catalogue });
    return db.transaction(() => {
      const at = Date.now(), files = store.files(), candidates = store.candidates();
      const states = new Map(db.prepare('SELECT key,value FROM acquisition_state').all().map(r => [r.key, r.value]));
      const media = catalogue.listMedia(false), byId = new Map(media.map(m => [m.id, m]));
      store.files = () => files;
      store.candidates = wanted => wanted ? candidates.filter(c => wanted.includes(c.state)) : candidates;
      store.state = key => states.get(key);
      catalogue.listMedia = enabled => enabled === false ? media : media.filter(m => m.enabled);
      const service = Object.assign(Object.create(ContentAcquisition.prototype), { app, config, db: catalogue, store, root: path.join(app.media.root, '.acquisition') });
      const newBytes = service.newBytes();
      service.newBytes = () => newBytes;
      const usage = new Map(config.subscriptions.map(s => [s.id, service.usage(s.id)]));
      service.usage = id => usage.get(id);
      const lease = db.prepare('SELECT owner,expires FROM acquisition_lock WHERE id=1').get();
      const pid = Number(lease?.owner.split(':')[0]);
      const workerActive = Boolean(lease?.expires > at && Number.isSafeInteger(pid) && pid > 0 && processAlive(pid, at));
      const downloads = service.currentDownloads().map(d => ({ programme: safeText(d.programme), title: safeText(d.title), downloadedBytes: d.downloadedBytes, lastProgressSecondsAgo: d.lastProgressSecondsAgo }));
      const activeId = (() => { try { const d = JSON.parse(states.get('active-download') ?? ''); return workerActive && d.pid === pid ? d.id : null; } catch { return null; } })();
      const ready = [], delayed = [], reasons = [], shows = [];
      for (const s of [...config.subscriptions].sort((a, b) => b.priority - a.priority)) {
        const owned = files.filter(f => f.show_id === s.id && f.state === 'indexed' && byId.get(f.catalogue_id)?.enabled);
        const rows = candidates.filter(c => c.metadata.showId === s.id), counts = new Map();
        let nowCount = 0, later = 0;
        const addReason = reason => { const text = safeText(reason.startsWith('duplicate:') ? 'Already in library' : reason); counts.set(text, (counts.get(text) ?? 0) + 1); };
        for (const row of rows) {
          if (['manual', 'quarantine'].includes(row.state)) addReason(row.reason || row.state);
          if (!['discovered', 'deferred', 'processing', 'bounded'].includes(row.state) || row.id === activeId) continue;
          if (row.attempts >= 5 && !usesStreamExtractor(row.metadata)) { addReason('Retry limit reached; manual preparation required'); continue; }
          const reason = service.budget(row.metadata, s);
          if (reason) { if (!reason.startsWith('duplicate:')) addReason(reason); continue; }
          if (['manual', 'existing'].includes(s.source) || row.state === 'bounded') continue;
          if (row.retryAt > at) { delayed.push(row); later++; addReason(row.reason || 'Waiting for retry'); }
          else { ready.push(row); nowCount++; }
        }
        const blocked = rows.filter(c => ['manual', 'quarantine'].includes(c.state)).length;
        let plan = nowCount ? 'Queued' : later ? 'Waiting for retry' : blocked ? 'Source failures' : 'No candidates';
        if (usage.get(s.id).episodes >= s.targetEpisodes) plan = 'Target reached';
        else if (s.source === 'existing') plan = 'Existing library only';
        else if (s.source === 'manual') plan = 'Manual source';
        else if (counts.size && !nowCount && !later) plan = [...counts].sort((a, b) => b[1] - a[1])[0][0];
        if (rows.some(c => c.id === activeId)) plan = downloads.length ? 'Downloading' : 'Preparing / downloading';
        shows.push({ title: safeText(s.title), language: s.language, have: owned.length, target: s.targetEpisodes,
          continuous: Boolean(s.editorialClassification),
          rankCounts: s.editorialClassification ? Object.fromEntries(['A+', 'A', 'B', 'C', 'D', 'X', 'pending'].map(rank =>
            [rank, rows.filter(row => (row.metadata.classification?.rank ?? 'pending') === rank).length])) : null,
          added: owned.filter(f => f.new_asset).length, durationMs: owned.reduce((n, f) => n + byId.get(f.catalogue_id).durationMs, 0),
          bytes: owned.reduce((n, f) => n + f.size, 0), ready: nowCount, later, blocked, plan });
        if (!['Target reached', 'Existing library only'].includes(plan)) {
          for (const [reason, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2)) reasons.push({ show: safeText(s.title), reason, count });
          if (!counts.size && ['Manual source', 'No candidates'].includes(plan)) reasons.push({ show: safeText(s.title), reason: plan, count: 1 });
        }
      }
      ready.sort((a, b) => { const sa = service.sub(a.metadata.showId), sb = service.sub(b.metadata.showId); return rankPriority(b.metadata.classification?.rank) - rankPriority(a.metadata.classification?.rank) || sb.priority - sa.priority + candidateScore(b.metadata, sb) / 100 - candidateScore(a.metadata, sa) / 100 || a.id.localeCompare(b.id); });
      let freeBytes = null;
      try { const stat = fs.statfsSync(app.media.root); freeBytes = stat.bavail * stat.bsize; } catch { /* disk may be unmounted */ }
      const next = ready.slice(0, limit).map(c => ({ show: safeText(service.sub(c.metadata.showId).title), title: safeText(c.metadata.classification?.title ?? c.metadata.title), rank: c.metadata.classification?.rank ?? '', attempts: c.attempts }));
      const recent = files.filter(f => f.new_asset && f.state === 'indexed' && byId.get(f.catalogue_id)?.enabled).sort((a, b) => b.acquired_at - a.acquired_at).slice(0, limit)
        .map(f => ({ at: f.acquired_at, show: safeText(byId.get(f.catalogue_id).showTitle), title: safeText(byId.get(f.catalogue_id).episodeTitle), bytes: f.size }));
      return { at, timeZone: app.channel.timezone, activity: downloads.length ? 'downloading' : workerActive ? 'working' : 'waiting', workerActive, downloads,
        nextRun: Number(states.get('next-automatic-run')) || null, lastDiscovery: Number(states.get('last-discovery')) || null,
        inventoryComplete: states.get('inventory-complete') === '1', publicationPending: states.get('schedule-dirty') === '1',
        classificationStatus: safeText(states.get('classification-status') ?? ''),
        shows, newBytes, maxNewBytes: config.maxNewBytes, reserveBytes: config.reserveBytes, freeBytes, rate: config.downloadBytesPerSecond,
        readyTotal: ready.length, earliestRetry: delayed.length ? Math.min(...delayed.map(c => c.retryAt)) : null, next, reasons, recent };
    })();
  } finally { db.close(); }
}
async function display() {
  try {
    const report = await collect();
    if (args.includes('--watch') && process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : renderReport(report));
  } catch {
    console.error('Cannot read acquisition status. Check that the acquisition release, policy and catalogue are available.');
    process.exitCode = 1;
  }
}
await display();
if (args.includes('--watch') && !process.exitCode) {
  const timer = setInterval(display, 10000);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); process.exit(0); });
}
