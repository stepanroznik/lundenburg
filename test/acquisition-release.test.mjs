import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';

const release = process.env.LKP_ACQUISITION_RELEASE;
test('Ms Rachel threshold admits only A/A+, preserves cache and leaves Miss Josi B eligible', { skip: !release }, async () => {
  const [{ loadAcquisitionConfig, admission }, { EducationalClassifier }] = await Promise.all([
    import(pathToFileURL(path.join(release, 'dist/src/acquisition/model.js'))),
    import(pathToFileURL(path.join(release, 'dist/src/acquisition/classification.js'))),
  ]);
  const { default: Database } = await import('better-sqlite3');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-rank-policy-'));
  const db = new Database(':memory:');
  try {
    const file = path.join(root, 'policy.yaml');
    const yaml = parse(fs.readFileSync(path.join(release, 'config/content-acquisition.yaml'), 'utf8'));
    fs.writeFileSync(file, stringify(yaml));
    const policy = loadAcquisitionConfig({ projectRoot: root }, file);
    const rachel = policy.subscriptions.find(s => s.id === 'ms-rachel');
    const josi = policy.subscriptions.find(s => s.id === 'miss-josi');
    assert.equal(rachel.minimumEditorialRank, 'A');
    const classifier = new EducationalClassifier(db);
    const result = { rank: 'B', contentType: 'episode', title: 'Lernen', descriptionDe: 'Wir lernen erste Wörter.', seasonalTags: [], topics: [], reason: 'Lerninhalt', ageSuitability: 'toddler', duplicateAssessment: 'no-evidence' };
    classifier.save('unchanged-video', result, 'fixture');
    const candidate = { size: 100000, durationMs: 600000, available: true, title: 'Learning', description: '', classification: classifier.cached('unchanged-video') };
    const usage = { bytes: 0, episodes: 0, durationMs: 0 };
    assert.match(admission({ ...candidate, language: 'en' }, rachel, usage, 0, policy), /Editorial rank excluded/);
    for (const rank of ['A', 'A+']) assert.equal(admission({ ...candidate, language: 'en', classification: { ...result, rank } }, rachel, usage, 0, policy), undefined);
    assert.equal(admission({ ...candidate, language: 'de' }, josi, usage, 0, policy), undefined);
    assert.deepEqual(classifier.cached('unchanged-video'), result);
    yaml.subscriptions.find(s => s.id === 'ms-rachel').minimumEditorialRank = 'C';
    fs.writeFileSync(file, stringify(yaml));
    assert.throws(() => loadAcquisitionConfig({ projectRoot: root }, file), /Invalid minimum editorial rank/);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('free-space storage removes byte caps, keeps editorial limits and reserves staging headroom', { skip: !release }, async () => {
  const load = name => import(pathToFileURL(path.join(release, `dist/src/${name}.js`)));
  const [{ loadAcquisitionConfig, admission }, { reserve, Deferred }] = await Promise.all([load('acquisition/model'), load('acquisition/io')]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-storage-policy-'));
  const file = path.join(root, 'policy.yaml');
  const yaml = parse(fs.readFileSync(path.join(release, 'config/content-acquisition.yaml'), 'utf8'));
  const statfs = fs.statfsSync;
  try {
    assert.equal(yaml.reserveBytes, 80000000000);
    assert.equal(yaml.maxNewBytes, null);
    assert.ok(yaml.subscriptions.every(s => s.maxBytes === null));
    fs.writeFileSync(file, stringify(yaml));
    const policy = loadAcquisitionConfig({ projectRoot: root }, file);
    const s = policy.subscriptions.find(s => s.id === 'miss-josi');
    const candidate = { size: 2e9, durationMs: 600000, available: true, language: 'de', title: 'First words', description: '', classification: { rank: 'A' } };
    const usage = { bytes: 100e9, durationMs: 0, episodes: 0 };
    assert.equal(admission(candidate, s, usage, 300e9, policy), undefined);
    assert.match(admission({ ...candidate, classification: { rank: 'C' } }, s, usage, 300e9, policy), /Editorial rank/);
    assert.match(admission(candidate, s, { ...usage, episodes: s.targetEpisodes }, 300e9, policy), /target reached/);
    // 2 GB source plus 2 GB temporary output: 84 GB free is sufficient,
    // while 83 GB free defers acquisition without overrunning the 80 GB reserve.
    let free = 84e9;
    fs.statfsSync = () => ({ bavail: free, bsize: 1 });
    assert.doesNotThrow(() => reserve(root, candidate.size * 2, policy.reserveBytes));
    free = 83e9;
    assert.throws(() => reserve(root, candidate.size * 2, policy.reserveBytes), Deferred);
    free = 84e9;
    assert.doesNotThrow(() => reserve(root, candidate.size * 2, policy.reserveBytes));
    yaml.maxNewBytes = 160 * 2 ** 30; yaml.subscriptions.forEach(s => { s.maxBytes = 64 * 2 ** 30; });
    fs.writeFileSync(file, stringify(yaml));
    const capped = loadAcquisitionConfig({ projectRoot: root }, file);
    assert.match(admission(candidate, capped.subscriptions.find(s => s.id === 'miss-josi'), usage, 300e9, capped), /byte budget/);
    yaml.reserveBytes = 0;
    fs.writeFileSync(file, stringify(yaml));
    assert.throws(() => loadAcquisitionConfig({ projectRoot: root }, file), /reserveBytes/);
  } finally { fs.statfsSync = statfs; fs.rmSync(root, { recursive: true, force: true }); }
});

test('educational ingestion reuses German classification, retains subtitles/markers/provenance and preserves duplicate keys', { skip: !release }, async () => {
  const load = name => import(pathToFileURL(path.join(release, `dist/src/${name}.js`)));
  const [{ ContentAcquisition }, { loadAcquisitionConfig, admission }, { LkpDatabase }, { config }, { execute, reserve, Deferred }, { EducationalClassifier, applyClassification }] = await Promise.all([
    load('acquisition/service'), load('acquisition/model'), load('database'),
    import(pathToFileURL(path.join(release, 'dist/test/helpers.js'))), load('acquisition/io'), load('acquisition/classification'),
  ]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-learning-ingest-')), app = config(root);
  app.media.mountPoint = undefined; fs.mkdirSync(app.media.root, { recursive: true });
  const policy = loadAcquisitionConfig(app, path.join(release, 'config/content-acquisition.yaml'));
  const subscription = { ...policy.subscriptions.find(s => s.id === 'miss-josi'), maxBytes: 10000000 };
  Object.assign(policy, { reserveBytes: 1, maxNewBytes: 10000000, credentialsFile: path.join(root, 'absent.env'), subtitleProviders: [], editorialProviders: [], subscriptions: [subscription], publishToSchedule: false });
  const db = new LkpDatabase(app.storage.database), service = new ContentAcquisition(app, db, policy);
  try {
    service.dirs(); service.store.set('inventory-complete', '1');
    const file = path.join(root, 'incoming.mp4');
    await execute('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=854x480:r=10:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', file]);
    fs.writeFileSync(path.join(root, 'incoming.de.srt'), '1\n00:00:00,100 --> 00:00:01,000\nHallo!\n');
    fs.writeFileSync(path.join(root, 'incoming.yaml'), 'markers:\n  - {kind: credits, startMs: 1500, endMs: 2000, source: manual, confidence: 1}\n');
    const c = { source: 'youtube', sourceId: 'd-uF2J9xAWQ', sourceUrl: 'https://www.youtube.com/watch?v=d-uF2J9xAWQ', showId: subscription.id,
      title: 'Original first words', language: 'de', description: 'Raw source description', descriptionLanguage: 'de', durationMs: 2000, size: 100000,
      broadcaster: 'Miss Josi', components: [], compilation: false, format: 'episode', available: true, publishedAt: Date.UTC(2025, 0, 1) };
    const classification = { rank: 'A+', contentType: 'interstitial', title: 'Erste Worte', descriptionDe: 'Miss Josi übt mit den Kindern erste Wörter.', seasonalTags: ['christmas'], topics: ['Sprache'], reason: 'Sprachförderung', ageSuitability: 'toddler', duplicateAssessment: 'no-evidence' };
    new EducationalClassifier(db.db).save(c.sourceId, classification, 'fixture'); applyClassification(c, classification);
    for (const rank of ['C', 'D', 'X']) assert.match(admission({ ...c, classification: { ...classification, rank } }, subscription, { bytes: 0, durationMs: 0, episodes: 0 }, 0, policy), /Editorial rank/);
    assert.match(admission(c, { ...subscription, maxBytes: 1 }, { bytes: 0, durationMs: 0, episodes: 0 }, 0, policy), /byte budget/);
    assert.throws(() => reserve(app.media.root, Number.MAX_SAFE_INTEGER, 1), Deferred);
    const id = service.store.remember(c), row = service.store.candidates().find(row => row.id === id);
    await service.ingest(row, file);
    const [item] = db.listMedia();
    assert.equal(item.episodeTitle, classification.title); assert.equal(item.description, classification.descriptionDe);
    assert.equal(item.audioLanguage, 'de'); assert.equal(item.season, undefined); assert.equal(item.episode, 1); assert.equal(item.technical.catalogue.episodeNumberSource, 'local');
    assert.equal(item.technical.acquisition.sourceId, c.sourceId); assert.deepEqual(item.technical.acquisition.classification, classification);
    assert.ok(item.subtitles.some(t => t.language === 'de')); assert.ok(item.editorialMarkers.some(m => m.kind === 'credits'));
    assert.equal(item.effectiveEditorialDurationMs, 1500);
    assert.equal(service.duplicate({ ...c, classification: { ...classification, rank: 'B' } }), item.id);
    await service.index(25);
    assert.equal(service.duplicate(c), item.id);
    service.store.remember({ ...c, classification: undefined, classificationVersion: undefined });
    assert.deepEqual(service.store.candidates().find(row => row.id === id).metadata.classification, classification);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('isolated release retries metadata and transfer errors and keeps scheduling separate', { skip: !release }, async t => {
  const { ContentAcquisition } = await import(pathToFileURL(path.join(release, 'dist/src/acquisition/service.js')));
  const { Deferred } = await import(pathToFileURL(path.join(release, 'dist/src/acquisition/io.js')));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-source-failure-'));
  const downloader = path.join(root, 'yt-dlp'), previous = process.env.LKP_YT_DLP;
  process.env.LKP_YT_DLP = downloader;
  const service = Object.assign(Object.create(ContentAcquisition.prototype), {
    app: { projectRoot: release }, root,
    config: { maxNewBytes: 10000000, reserveBytes: 1, connectTimeoutSeconds: 20,
      downloadStallSeconds: 120, downloadBytesPerSecond: 2097152, publishToSchedule: false },
    guard: { check() {} }, store: { remember() {}, state() { throw Error('Schedule publication touched the store'); } },
    usage: () => ({ bytes: 0 }), newBytes: () => 0, budget: () => undefined,
  });
  const candidate = { source: 'ct', sourceUrl: 'https://www.ceskatelevize.cz/porady/1-show/123/',
    sourceId: '123', showId: 'test', language: 'cs', components: [] };
  const subscription = { maxBytes: 10000000 };
  try {
    await t.test('HTTP 410 during metadata extraction remains retryable and diagnostics stay private', async () => {
      fs.writeFileSync(downloader, '#!/usr/bin/python3\nimport sys\nsys.stderr.write("HTTP Error 410: Gone https://example.org/?token=sentinel")\nsys.exit(1)\n', { mode: 0o755 });
      await assert.rejects(service.downloadCandidateInner({ ...candidate }, root, subscription), error => {
        assert.ok(error instanceof Deferred);
        assert.match(error.message, /HTTP 410.*retry scheduled/);
        assert.doesNotMatch(error.message, /sentinel|example\.org/);
        return true;
      });
    });
    await t.test('HTTP 503 during media transfer remains retryable', async () => {
      fs.writeFileSync(downloader, '#!/usr/bin/python3\nimport sys,json\nif "--dump-single-json" in sys.argv:\n print(json.dumps({"formats":[{"has_drm":False}],"duration":2}))\nelse:\n sys.stderr.write("HTTP Error 503: Service unavailable")\n sys.exit(1)\n', { mode: 0o755 });
      await assert.rejects(service.downloadCandidateInner({ ...candidate }, root, subscription), error => {
        assert.ok(error instanceof Deferred);
        assert.match(error.message, /HTTP 503.*retry scheduled/);
        return true;
      });
    });
    await t.test('ORF replaces a stale saved playlist with downloaded media, including expired-page fallback', async () => {
      const orf = { ...candidate, source: 'mediathek', broadcaster: 'ORF',
        sourceUrl: 'https://on.orf.at/video/123/show', downloadUrl: 'https://example.org/video.m3u8', durationMs: 2000 };
      fs.writeFileSync(path.join(root, 'source.mp4'), '#EXTM3U\nold.ts');
      fs.writeFileSync(downloader, `#!/usr/bin/python3
import sys,json
from pathlib import Path
if "--dump-single-json" in sys.argv:
 print(json.dumps({"formats":[],"entries":[],"duration":0} if "on.orf.at" in sys.argv[-1] else {"formats":[{"has_drm":False}]}))
else:
 assert sys.argv[-1] == "https://example.org/video.m3u8"
 Path(sys.argv[sys.argv.index("-o")+1].replace("%(ext)s","mp4")).write_bytes(b"\\0\\0\\0\\x14ftypisom")
`, { mode: 0o755 });
      const file = await service.downloadCandidateInner(orf, root, subscription);
      assert.equal(file, path.join(root, 'source.mp4'));
      assert.equal(fs.readFileSync(file).subarray(4, 8).toString(), 'ftyp');
      fs.rmSync(file);
    });
    await t.test('broadcast guard deferrals retain their meaning', async () => {
      service.guard.check = () => { throw new Deferred('Playout recovery is active'); };
      await assert.rejects(service.downloadCandidateInner({ ...candidate }, root, subscription),
        error => error instanceof Deferred && error.message === 'Playout recovery is active');
    });
    await t.test('download-only policy cannot regenerate the schedule', async () => {
      await service.regenerate();
    });
  } finally {
    if (previous === undefined) delete process.env.LKP_YT_DLP;
    else process.env.LKP_YT_DLP = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('existing EPG translation uses ChatGPT cache and local fallback, while educational metadata makes no second call', { skip: !release }, async () => {
  const [{ germanDescription }, { AiService }, { default: Database }] = await Promise.all([
    import(pathToFileURL(path.join(release, 'dist/src/acquisition/enrichment.js'))),
    import(pathToFileURL(path.join(release, 'dist/src/ai/service.js'))), import('better-sqlite3'),
  ]);
  const db = new Database(':memory:'); let calls = 0;
  const text = 'Die Kinder entdecken gemeinsam Tiere und lernen neue Wörter.';
  const config = { aiProvider: 'chatgpt', credentialsFile: '/no-api-credentials-should-be-read', metadataModel: 'unused' };
  const candidate = { sourceId: 'fixture-video', title: 'Learn animals', description: 'Learn animal names and words together.', descriptionLanguage: 'en' };
  const subscription = { title: 'Learning', description: 'Ein Lernprogramm.' };
  const ai = new AiService(db, { accessToken: async () => 'fixture-access' }, async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-access');
    if (url.endsWith('/models')) return new Response(JSON.stringify({ models: [{ slug: 'fixture-mini', visibility: 'list' }] }));
    calls++; const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.stream, true);
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ descriptionDe: text }) }] }] } }) + '\n\n',
      { headers: { 'content-type': 'text/event-stream' } });
  });
  try {
    const context = { database: db, projectRoot: release, ai };
    assert.equal((await germanDescription(candidate, subscription, config, true, context)).text, text);
    assert.equal((await germanDescription(candidate, subscription, config, true, context)).text, text); assert.equal(calls, 1);
    assert.equal((await germanDescription({ ...candidate, classification: { descriptionDe: 'Bereits klassifiziert.' } }, subscription, config, true, context)).text, 'Bereits klassifiziert.');
    assert.equal(calls, 1);
    assert.equal((await germanDescription({ ...candidate, descriptionLanguage: 'de', description: text }, subscription, config, true, context)).provenance.method, 'source');
    assert.equal((await germanDescription(candidate, subscription, config, true)).provenance.method, 'fallback');
    const missing = new AiService(db, { accessToken: async () => { throw Error('Missing sign-in'); } });
    assert.equal((await germanDescription({ ...candidate, sourceId: 'unseen-id' }, subscription, config, true, { ...context, ai: missing })).provenance.method, 'fallback');
    assert.equal(calls, 1);
  } finally { db.close(); }
});
