import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { AiService, consumeResponse, responseText, smallClassificationModel } from '../src/ai/service.js';
import { AiError } from '../src/ai/errors.js';
import { EducationalClassifier, type ClassifiedCandidate } from '../src/acquisition/classification.js';

const event = (value: unknown) => new Response(`data: ${JSON.stringify(value)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const catalog = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
test('headerless direct-route SSE reconstructs streamed output omitted from the completed snapshot', async () => {
  const text = JSON.stringify({ title: 'Wörter und Gefühle' });
  const raw = [
    { type: 'response.created', response: { status: 'in_progress', output: [] } },
    ...[text.slice(0,12), text.slice(12)].map(delta => ({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta })),
    { type: 'response.output_text.done', output_index: 0, content_index: 0, text },
    { type: 'response.completed', response: { status: 'completed', output: [] } },
  ].map(value => `data: ${JSON.stringify(value)}\r\n\r\n`).join('');
  const encoded = new TextEncoder().encode(raw);
  const response = new Response(new ReadableStream({ start(controller) { for(const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
  assert.equal(response.headers.get('content-type'), null);
  const result = await consumeResponse(response); assert.equal(result.status, 'completed');
  assert.equal(responseText(result), text); // done replaces deltas; never duplicates them.
});
test('actual ChatGPT catalog selects GPT-6 Luna with no reasoning and rejects expensive alternatives', async () => {
  const db = new Database(':memory:');
  try {
    const ai = new AiService(db, { accessToken: async () => 'fixture-access' }, async (url, init) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ models: catalog.map(slug => ({ slug, visibility: 'list' })) }));
      const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'gpt-6-luna');
      assert.deepEqual(body.reasoning, { effort: 'none' }); assert.equal(body.stream, true); assert.equal(body.store, false);
      assert.equal(body.max_output_tokens, undefined);
      return event({ type: 'response.completed', response: { status: 'completed', output: [] } });
    });
    assert.equal((await ai.respond({ model: 'auto-small', instructions: 'Short metadata only', input: 'fixture', version: 'v1' })).model, 'gpt-6-luna');
    assert.equal(smallClassificationModel('gpt-6-luna'), true);
    for (const model of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna-pro', 'expensive-reasoning-mini']) assert.equal(smallClassificationModel(model), false);
  } finally { db.close(); }
});

test('a streamed allowance failure defers classification, removes provisional receipt and does not cache a rejection', async () => {
  const db = new Database(':memory:'); let calls = 0;
  const c: ClassifiedCandidate = { sourceId: 'fixture1234', sourceUrl: 'https://www.youtube.com/watch?v=fixture1234', showId: 'miss-josi',
    title: 'First words', language: 'de', description: 'Learning first words for toddlers.', descriptionLanguage: 'de', durationMs: 746000, size: 1000,
    components: [], available: true, compilation: false, format: 'episode' };
  const result = { rank: 'A', contentType: 'episode', title: 'Erste Worte', descriptionDe: 'Gemeinsam erste Wörter lernen.',
    seasonalTags: [], topics: ['Sprache'], reason: 'Sprachförderung.', ageSuitability: 'toddler', duplicateAssessment: 'no-evidence' };
  try {
    const ai = new AiService(db, { accessToken: async () => 'fixture-access' }, async () => {
      calls++; return calls === 1 ? event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private message never logged' } } })
        : event({ type: 'response.completed', response: { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] } });
    });
    const classifier = new EducationalClassifier(db);
    await assert.rejects(classifier.classify(c, 'Miss Josi', { metadataModel: 'gpt-6-luna' }, undefined, async () => { throw Error(); }, ai),
      (error: unknown) => error instanceof AiError && error.kind === 'allowance' && !error.message.includes('private'));
    assert.equal(classifier.cached(c.sourceId), undefined);
    assert.equal((db.prepare('SELECT count(*) AS n FROM ai_responses').get() as { n: number }).n, 0);
    await assert.rejects(classifier.classify(c, 'Miss Josi', { metadataModel: 'gpt-6-luna' }, undefined, async () => { throw Error(); }, ai), AiError);
    assert.equal(calls, 1);
    db.prepare("UPDATE ai_state SET value='0' WHERE key='next-at'").run();
    assert.equal((await classifier.classify(c, 'Miss Josi', { metadataModel: 'gpt-6-luna' }, undefined, async () => { throw Error(); }, ai)).rank, 'A');
    assert.equal(calls, 2);
    await classifier.classify(c, 'Miss Josi', { metadataModel: 'gpt-6-luna' }, undefined, async () => { throw Error(); }, ai);
    assert.equal(calls, 2);
  } finally { db.close(); }
});
