import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import { safeText, table, renderReport } from '../scripts/acquisition-report.mjs';

test('terminal cells normalize accents, prevent control sequences and redact provider URLs', () => {
  assert.equal(safeText('Ba\u0308r\n\x1b[31m https://example.org/?token=hidden'), 'Bär  [31m [URL]');
  assert.doesNotMatch(safeText('api_key=secret password=hidden'), /secret|hidden/);
  assert.equal(table(['Show', 'Count'], [['Ba\u0308r', 1], ['Duck', 2]]), 'Show  Count\n----  -----\nBär   1\nDuck  2');
});

test('report describes absent work as discovery-dependent, without claiming exhaustion', () => {
  const report = renderReport({ at: 1000, timeZone: 'Europe/Vienna', activity: 'waiting', downloads: [], workerActive: false,
    nextRun: 500, lastDiscovery: null, inventoryComplete: false, publicationPending: false, shows: [],
    newBytes: 0, maxNewBytes: 100, reserveBytes: 10, freeBytes: null, rate: 2097152,
    readyTotal: 0, next: [], earliestRetry: null, reasons: [], recent: [] });
  assert.match(report, /due now/);
  assert.match(report, /future discovery may find more/);
  assert.match(report, /Inventory: incomplete/);
});

test('report explains uncapped storage and preserves decimal GB reserve units in JSON', () => {
  const report = renderReport({ at: 1000, timeZone: 'Europe/Vienna', activity: 'waiting', downloads: [], workerActive: false,
    nextRun: null, lastDiscovery: null, inventoryComplete: true, publicationPending: false, shows: [],
    newBytes: 140 * 2 ** 30, maxNewBytes: null, reserveBytes: 80000000000, freeBytes: 90e9, rate: 2097152,
    readyTotal: 0, next: [], earliestRetry: null, reasons: [], recent: [] });
  assert.match(report, /no fixed byte cap; governed by disk reserve/);
  assert.match(report, /Keep free: 80\.0 GB \(74\.5 GiB\)/);
  assert.doesNotMatch(report, /Infinity|NaN/);
});

const release = process.env.LKP_ACQUISITION_RELEASE ?? '/home/lundenburg/lkp-content/current';
test('CLI uses a read-only snapshot, respects policy/retry delays, and emits only safe JSON', { skip: !fs.existsSync(release) }, async () => {
  const load = name => import(pathToFileURL(path.join(release, `dist/src/${name}.js`)));
  const [{ LkpDatabase }, { AcquisitionStore }] = await Promise.all([load('database'), load('acquisition/store')]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-report-test-'));
  const file = path.join(dir, 'catalogue.sqlite');
  const configFile = path.join(dir, 'lkp.yaml');
  const config = parse(fs.readFileSync(path.join(release, 'config/lkp.yaml'), 'utf8'));
  delete config.media.mountPoint;
  config.media.root = dir;
  config.media.generatedRoot = path.join(dir, '.generated');
  fs.writeFileSync(configFile, stringify(config));
  try {
    const catalogue = new LkpDatabase(file), store = new AcquisitionStore(catalogue);
    store.set('inventory-complete', '1');
    const candidate = { source: 'ct', sourceId: 'report-test', sourceUrl: 'https://www.ceskatelevize.cz/porady/1/123/',
      showId: 'byl-jednou-jeden-zivot', title: 'Episode https://example.org/?token=sentinel',
      language: 'cs', description: '', components: [], durationMs: 1500000, size: 10000000,
      available: true, format: 'episode', compilation: false };
    store.remember(candidate);
    const later = store.remember({ ...candidate, sourceId: 'later', title: 'Delayed episode' });
    store.transition(later, 'deferred', 'Downloader network; retry scheduled', Date.now() + 3600000);
    const blocked = store.remember({ ...candidate, sourceId: 'blocked', title: 'Unavailable', available: false });
    store.transition(blocked, 'manual', 'source unavailable; manual acquisition required');
    catalogue.close();
    const hash = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before = hash();
    const result = spawnSync(process.execPath, ['scripts/acquisition-status.mjs', '--json', '--limit', '1'], {
      cwd: path.resolve('.'), encoding: 'utf8', timeout: 30000,
      env: { ...process.env, LKP_DATABASE: file, LKP_MEDIA_ROOT: dir, LKP_CONFIG: configFile, LKP_GENERATED_MEDIA_ROOT: config.media.generatedRoot },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(hash(), before, 'report must not change the database');
    const report = JSON.parse(result.stdout), show = report.shows.find(s => s.language === 'cs' && s.target === 26);
    assert.equal(show.ready, 1);
    assert.equal(show.later, 1);
    assert.equal(show.blocked, 1);
    assert.equal(report.next.length, 1);
    assert.match(report.next[0].title, /\[URL\]/);
    assert.doesNotMatch(result.stdout, /sentinel|ceskatelevize\.cz|example\.org|credentials|tokenFile/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
