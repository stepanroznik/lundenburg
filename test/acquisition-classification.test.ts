import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { test } from 'node:test';
import { acquiredRank, applyClassification, classifyPending, classificationPrompt, ClassificationApiError, EducationalClassifier, preserveClassification, promptVersion,
  rankPriority, validateClassification, type ClassifiedCandidate, type Classification } from '../src/acquisition/classification.js';
import { playlistCandidates, validateYoutubeSubscription, youtubeEstimatedBytes, discoverYoutube, AcquisitionCommandError } from '../src/acquisition/adapters.js';

const result: Classification = { rank: 'A+', contentType: 'episode', title: 'Erste Worte', descriptionDe: 'Miss Josi übt mit den Kindern erste Wörter.',
  seasonalTags: [], topics: ['Sprache'], reason: 'Eigenständige Sprachförderung.', ageSuitability: 'toddler', duplicateAssessment: 'no-evidence' };
const candidate = (): ClassifiedCandidate => ({ sourceId: 'd-uF2J9xAWQ', sourceUrl: 'https://www.youtube.com/watch?v=d-uF2J9xAWQ', showId: 'miss-josi', title: 'First Words',
  language: 'de', description: 'Learn first words', descriptionLanguage: 'de', durationMs: 746000, size: 1000000, components: [], available: true, compilation: false, format: 'episode' });
const subscription = { id: 'miss-josi', title: 'Miss Josi', language: 'de', editorialClassification: true, minDuration: 1, maxDuration: 86400,
  channelId: 'UC2NKVbtgZEaJNBflx5bwHAg', urls: ['videos', 'streams', 'shorts'].map(t => `https://www.youtube.com/channel/UC2NKVbtgZEaJNBflx5bwHAg/${t}`) };
const response = (value: unknown) => JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

test('official channel discovery retains long programmes, songs and venues, rejects impersonation', () => {
  validateYoutubeSubscription(subscription);
  assert.throws(() => validateYoutubeSubscription({ ...subscription, urls: ['https://www.youtube.com/@unverified/videos'] }));
  const videos = playlistCandidates({ channel_id: subscription.channelId, entries: [
    { id: 'abcdefghijk', title: 'Pony Farm - Elldus Resort', duration: 2537 },
    { id: 'abcdefghij2', title: 'Numbers 3 hours', duration: 10800 },
    { id: 'abcdefghij3', title: 'ABC Lied', duration: 133 },
    { id: 'abcdefghij4', title: 'Trailer', duration: 25 },
  ] }, subscription);
  assert.equal(videos.length, 4); assert.equal(videos[3]!.invalidReason, 'Trailer or preview');
  assert.equal(videos[0]!.language, 'de');
  assert.throws(() => playlistCandidates({ channel_id: 'UCwrong', entries: [] }, subscription));
  assert.throws(() => playlistCandidates({ channel_id: subscription.channelId, entries: [{ id: 'abcdefghijk', title: 'Reupload', channel_id: 'UCwrong' }] }, subscription));
});

test('strict local JSON validation keeps ranks, formats and seasonal metadata independent', () => {
  assert.deepEqual(validateClassification({ ...result, rank: 'B', contentType: 'interstitial', seasonalTags: ['christmas'] }),
    { ...result, rank: 'B', contentType: 'interstitial', seasonalTags: ['christmas'] });
  for (const value of [null, { ...result, rank: 'X' }, { ...result, title: '' }, { ...result, descriptionDe: 'a'.repeat(601) },
    { ...result, extra: true }, { ...result, seasonalTags: ['birthday'] }, { ...result, topics: [3] }, { ...result, contentType: 'bilingual' },
    { ...result, ageSuitability: 'adult' }, { ...result, ageSuitability: 'unsuitable' }, { ...result, duplicateAssessment: 'verified-overlap' }]) assert.throws(() => validateClassification(value));
  for (const rank of ['A+', 'A', 'B']) assert.ok(acquiredRank(rank));
  for (const rank of ['C', 'D', 'X', undefined]) assert.equal(acquiredRank(rank), false);
  for (const rank of ['A+', 'A']) assert.ok(acquiredRank(rank, 'A'));
  for (const rank of ['B', 'C', 'D', 'X', undefined]) assert.equal(acquiredRank(rank, 'A'), false);
  assert.equal(acquiredRank('A', 'A+'), false);
  assert.equal(acquiredRank('A+', 'A+'), true);
  assert.equal(acquiredRank('A+', 'invalid'), false);
  assert.ok(rankPriority('A+') > rankPriority('A')); assert.ok(rankPriority('A') > rankPriority('B'));
});

test('one bounded Responses request supplies everything and is cached across classifier instances', async () => {
  const db = new Database(':memory:'); let calls = 0;
  try {
    const c = candidate(); c.description = 'd'.repeat(9000);
    const request = async (_url: string, options: RequestInit) => {
      calls++; const body = JSON.parse(String(options.body));
      assert.equal(body.model, 'gpt-4.1-mini'); assert.equal(body.text.format.strict, true);
      assert.equal(JSON.parse(body.input).description.length, 1800);
      assert.equal(body.store, false); assert.equal(body.reasoning, undefined);
      assert.equal(body.instructions, classificationPrompt);
      assert.deepEqual(Object.keys(JSON.parse(body.input)).sort(), ['description', 'durationSeconds', 'programme', 'publishedAt', 'signals', 'title']);
      return response(result);
    };
    const classifier = new EducationalClassifier(db);
    assert.deepEqual(await classifier.classify(c, 'Miss Josi', { metadataModel: 'gpt-4.1-mini' }, 'test-fixture', request), result);
    assert.deepEqual(await new EducationalClassifier(db).classify(c, 'Miss Josi', { metadataModel: 'gpt-4.1-mini' }, undefined, request), result);
    assert.equal(calls, 1);
    const row = db.prepare('SELECT prompt_version FROM acquisition_classifications').get() as { prompt_version: string };
    assert.equal(row.prompt_version, promptVersion);
    applyClassification(c, result); const fresh = candidate(); preserveClassification(c, fresh);
    assert.deepEqual(fresh.classification, result); assert.equal(fresh.title, 'First Words');
  } finally { db.close(); }
});

test('a prompt revision reuses historical decisions and preserves their provenance without another successful call', async () => {
  const db = new Database(':memory:');
  try {
    const classifier = new EducationalClassifier(db);
    for (const rank of ['A', 'B', 'C', 'X'] as const) {
      const c = { ...candidate(), sourceId: `historical-${rank}` };
      const saved = { ...result, rank };
      db.prepare('INSERT INTO acquisition_classifications VALUES(?,?,?,?,?)').run(c.sourceId, 'educational-v2', JSON.stringify(saved), 'original-model', 1);
      const actual = await classifier.classify(c, 'Miss Josi', { metadataModel: 'gpt-4.1-mini' }, undefined,
        async () => { throw Error('Historical upload was reclassified'); });
      assert.deepEqual(actual, saved);
      assert.equal(classifier.version(c.sourceId), 'educational-v2');
      applyClassification(c, actual, classifier.model(c.sourceId), classifier.version(c.sourceId));
      const fresh = { ...candidate(), sourceId: c.sourceId };
      preserveClassification(c, fresh);
      assert.deepEqual(fresh.classification, saved);
      assert.equal(fresh.classificationVersion, 'educational-v2');
      assert.equal(fresh.classificationModel, 'original-model');
      assert.deepEqual(classifier.save(c.sourceId, { ...result, rank: 'A+' }, 'replacement'), saved);
    }
    assert.equal((db.prepare('SELECT COUNT(*) n FROM acquisition_classifications').get() as { n: number }).n, 4);
    assert.notEqual(promptVersion, 'educational-v2');
  } finally { db.close(); }
});

test('API failures are retryable, successful invalid output is conservatively cached with no second analysis', async () => {
  const db = new Database(':memory:'); const classifier = new EducationalClassifier(db), c = candidate(); let calls = 0;
  try {
    const failing = async () => { calls++; throw Error('HTTP 429 fixture'); };
    await assert.rejects(classifier.classify(c, 'Miss Josi', { metadataModel: 'gpt-4.1-mini' }, 'fixture', failing));
    assert.equal(classifier.cached(c.sourceId), undefined);
    const invalid = async () => { calls++; return response({ rank: 'A+' }); };
    assert.equal((await classifier.classify(c, 'Miss Josi', { metadataModel: 'gpt-4.1-mini' }, 'fixture', invalid)).rank, 'C');
    assert.equal((await classifier.classify(c, 'Miss Josi', { metadataModel: 'gpt-4.1-mini' }, 'fixture', invalid)).rank, 'C');
    assert.equal(calls, 2);
  } finally { db.close(); }
});

test('deterministic X uses no API call; expensive model cannot be used', async () => {
  const db = new Database(':memory:'); const classifier = new EducationalClassifier(db);
  try {
    assert.equal((await classifier.classify({ ...candidate(), invalidReason: 'YouTube Short' }, 'Miss Josi', { metadataModel: 'gpt-4.1-mini' }, undefined, async () => { throw Error('API touched'); })).rank, 'X');
    await assert.rejects(classifier.classify({ ...candidate(), sourceId: 'new-video' }, 'Miss Josi', { metadataModel: 'expensive-reasoning' }, 'fixture', async () => { throw Error('API touched'); }), /Invalid classification model/);
  } finally { db.close(); }
});

test('duplicate skips metadata and API; failed classification is deferred without leaking diagnostics', async () => {
  const db = new Database(':memory:'); const transitions: unknown[][] = [];
  const rows = [{ id: 'duplicate', metadata: candidate(), retryAt: 0 }, { id: 'new', metadata: { ...candidate(), sourceId: 'abcdefghijk' }, retryAt: 0 }];
  const service = { db: { db }, config: { metadataRequestsPerRun: 12, metadataModel: 'gpt-4.1-mini' }, app: { projectRoot: '/tmp' }, batchDeadline: Infinity,
    sub: () => subscription, guard: { check() {} }, duplicate: (c: ClassifiedCandidate) => c.sourceId === 'd-uF2J9xAWQ' ? 'existing-media' : undefined,
    store: { candidates: () => rows, state: () => undefined, set() {}, remember() {}, transition: (...v: unknown[]) => transitions.push(v) } };
  try {
    let extractions = 0;
    await classifyPending(service, { execute: async () => { extractions++; throw Error('secret-provider-sentinel'); }, request: async () => { throw Error('API touched'); }, credential: () => 'fixture', extractorArgs: () => [] });
    assert.equal(extractions, 1); assert.equal(transitions[0]![1], 'duplicate'); assert.equal(transitions[1]![1], 'deferred');
    assert.doesNotMatch(JSON.stringify(transitions), /secret-provider-sentinel/);
  } finally { db.close(); }
});

test('quota exhaustion pauses paid classification globally and resumes after the retry interval', async () => {
  const db = new Database(':memory:'), states = new Map<string, string>();
  const rows = [{ id: 'one', metadata: candidate(), retryAt: 0 }, { id: 'two', metadata: { ...candidate(), sourceId: 'abcdefghijk' }, retryAt: 0 },
    { id: 'excluded', metadata: { ...candidate(), sourceId: 'shortvideo1', invalidReason: 'YouTube Short' }, retryAt: 0 }];
  const metadata = JSON.stringify({ duration: 746, description: 'First words', size: 1000000 });
  for (const row of rows) states.set(`youtube-metadata-v1:${row.metadata.sourceId}`, metadata);
  const service = { db: { db }, config: { metadataRequestsPerRun: 12, metadataModel: 'gpt-4.1-mini' }, app: { projectRoot: '/tmp' }, batchDeadline: Infinity,
    sub: () => subscription, guard: { check() {} }, duplicate: () => undefined,
    store: { candidates: () => rows, state: (key: string) => states.get(key), set: (key: string, value: string) => states.set(key, value), remember() {}, transition() {} } };
  let calls = 0;
  const helpers = { execute: async () => { throw Error('Metadata cache ignored'); }, request: async () => { calls++; throw new ClassificationApiError(429, 'quota'); }, credential: () => 'fixture', extractorArgs: () => [] };
  try {
    await classifyPending(service, helpers); assert.equal(calls, 1);
    assert.equal(new EducationalClassifier(db).cached('shortvideo1')!.rank, 'X');
    assert.match(states.get('classification-status')!, /credit exhausted/);
    await classifyPending(service, helpers); assert.equal(calls, 1);
    states.set('classification-next-at', '0');
    await classifyPending(service, { ...helpers, request: async () => { calls++; return response(result); } });
    assert.equal(calls, 3); assert.equal(states.get('classification-status'), 'Available');
  } finally { db.close(); }
});

test('missing optional channel tabs do not mask real errors and all uploads are discovered', async () => {
  let calls = 0;
  const execute = async (_binary: string, args: string[]) => {
    calls++; assert.equal(args.includes('--playlist-end'), false);
    if (args.at(-1)!.endsWith('/streams')) throw new AcquisitionCommandError('missing-tab');
    return JSON.stringify({ channel_id: subscription.channelId, entries: [{ id: 'abcdefghijk', title: 'Programme', duration: 200 }] });
  };
  const candidates = await discoverYoutube(subscription, 1, 'yt-dlp', execute, () => {});
  assert.equal(calls, 3); assert.equal(candidates.length, 1);
  await assert.rejects(discoverYoutube(subscription, 1, 'yt-dlp', async () => { throw new AcquisitionCommandError('network'); }, () => {}));
});

test('selected-format sizes include both streams and fail conservatively when unknown', () => {
  assert.equal(youtubeEstimatedBytes({ requested_formats: [{ filesize: 100000 }, { filesize_approx: 10000 }] }, 100000), 115500);
  assert.equal(youtubeEstimatedBytes({}, 100000), 150000000);
});
