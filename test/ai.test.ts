import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { ChatGptAuth, authorizationUrl, createAttempt, issuer, resource, scopes, startSignIn, validateIdentity } from '../src/ai/auth.js';
import { CredentialStore, type Account } from '../src/ai/storage.js';
import { AiService, consumeResponse } from '../src/ai/service.js';
import { AiError } from '../src/ai/errors.js';
import { EducationalClassifier, classifyPending, type ClassifiedCandidate } from '../src/acquisition/classification.js';

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-ai-test-'));
const account = (): Account => ({ clientId: 'oaiapp_fixture', issuer, subject: 'fixture-subject', accessToken: 'fixture-access',
  refreshToken: 'fixture-refresh', idToken: 'fixture-id', expiresAt: Date.now() + 3600_000, earliestRefreshAt: 0, scopes });
const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const completed = (value: unknown) => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
function sse(result: unknown): Response {
  const encoded = new TextEncoder().encode(event({ type: 'response.created' }) + event({ type: 'response.completed', response: result }));
  return new Response(new ReadableStream({ start(controller) {
    // Single-byte chunks exercise UTF-8 characters and CRLF split across boundaries.
    for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
async function savedStore(directory: string): Promise<CredentialStore> {
  const store = new CredentialStore(directory), saved = await store.initialize();
  saved.accounts.oaiapp_fixture = account(); saved.active = 'oaiapp_fixture'; store.write(saved); return store;
}

test('host ID survives restarts, credentials are owner-only, symlinks and permissive files are rejected', async () => {
  const dir = temporary();
  try {
    const store = await savedStore(dir); const host = store.read()!.hostId;
    assert.equal((await new CredentialStore(dir).initialize()).hostId, host);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700); assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    fs.chmodSync(store.file, 0o644); assert.throws(() => store.read(), AiError);
    fs.chmodSync(store.file, 0o600); fs.renameSync(store.file, path.join(dir, 'real.json'));
    fs.symlinkSync(path.join(dir, 'real.json'), store.file); assert.throws(() => store.read(), AiError);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PKCE and state/nonce are fresh, dynamic registration exchanges the issued client, account mismatch is rejected', async () => {
  const dir = temporary(); let calls = 0;
  try {
    const store = new CredentialStore(dir), saved = await store.initialize(), attempt = createAttempt(saved.hostId, 1455);
    const other = createAttempt(saved.hostId, 1455); assert.notEqual(attempt.state, other.state); assert.notEqual(attempt.nonce, other.nonce);
    const url = new URL(authorizationUrl(attempt));
    assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(url.searchParams.get('agent_name_hint'), 'Lundenburg Kids Premium');
    assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(attempt.verifier).digest('base64url'));
    const auth = new ChatGptAuth(store, async (_url, options) => {
      calls++; const body = new URLSearchParams(String(options!.body));
      assert.equal(body.get('client_id'), 'oaiapp_fixture'); assert.equal(body.get('code_verifier'), attempt.verifier);
      assert.equal(body.get('redirect_uri'), attempt.redirectUri); assert.equal(body.get('resource'), resource);
      assert.equal(body.get('client_secret'), null);
      return json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', id_token: 'fixture-id', token_type: 'Bearer', expires_in: 3600, scope: scopes.join(' ') });
    }, async (_token, client, nonce) => { assert.equal(client, 'oaiapp_fixture'); assert.equal(nonce, attempt.nonce); return { sub: 'fixture-subject' }; });
    const callback = new URL(attempt.redirectUri); callback.search = new URLSearchParams({ state: attempt.state, code: 'fixture-code', client_id: 'oaiapp_fixture' }).toString();
    const bad = new URL(callback); bad.searchParams.set('state', 'wrong'); await assert.rejects(auth.complete(attempt, bad), AiError); assert.equal(calls, 0);
    const missing = new URL(callback); missing.searchParams.delete('client_id'); await assert.rejects(auth.complete(attempt, missing), AiError);
    await auth.complete(attempt, callback); assert.equal(store.read()!.active, 'oaiapp_fixture');
    const returning = createAttempt(saved.hostId, 54321, store.read()!.accounts.oaiapp_fixture);
    assert.equal(new URL(authorizationUrl(returning)).searchParams.get('agent_name_hint'), null);
    const mismatch = new URL(returning.redirectUri); mismatch.search = new URLSearchParams({ state: returning.state, code: 'fixture-code', client_id: 'another-client' }).toString();
    await assert.rejects(auth.complete(returning, mismatch), AiError); assert.equal(calls, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OIDC validates signature, issuer, audience, expiration, nonce and required subject', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'fixture', alg: 'RS256' }] });
  const signed = async (claims: Record<string, unknown> = {}, tokenIssuer = issuer, audience = 'oaiapp_fixture', expiration = '1h') =>
    new SignJWT({ sub: 'fixture-subject', nonce: 'fixture-nonce', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer(tokenIssuer).setAudience(audience).setIssuedAt().setExpirationTime(expiration).sign(privateKey);
  assert.equal((await validateIdentity(await signed(), 'oaiapp_fixture', 'fixture-nonce', keys)).sub, 'fixture-subject');
  for (const token of [await signed({}, 'https://wrong.example'), await signed({}, issuer, 'wrong-client'), await signed({}, issuer, 'oaiapp_fixture', '-1h'),
    await signed({ nonce: 'wrong' }), await signed({ sub: '' })]) await assert.rejects(validateIdentity(token, 'oaiapp_fixture', 'fixture-nonce', keys), AiError);
  const invalid = await signed(); await assert.rejects(validateIdentity(invalid.slice(0, -20) + 'wrong', 'oaiapp_fixture', 'fixture-nonce', keys), AiError);
});

test('failed first code exchange retains only the issued registration for fresh PKCE, without activating unverified identity', async () => {
  const dir = temporary();
  try {
    const store = new CredentialStore(dir), saved = await store.initialize(), attempt = createAttempt(saved.hostId, 1455);
    const auth = new ChatGptAuth(store, async () => json({ error: 'invalid_grant' }, 400));
    const callback = new URL(attempt.redirectUri); callback.search = new URLSearchParams({ state: attempt.state, code: 'fixture-code', client_id: 'oaiapp_fixture' }).toString();
    await assert.rejects(auth.complete(attempt, callback), AiError);
    assert.equal(store.read()!.pendingClientId, 'oaiapp_fixture'); assert.equal(store.read()!.active, undefined);
    assert.deepEqual(store.read()!.accounts, {});
    const retry = createAttempt(saved.hostId, 1455, undefined, store.read()!.pendingClientId);
    assert.equal(new URL(authorizationUrl(retry)).searchParams.get('client_id'), 'oaiapp_fixture'); assert.notEqual(retry.verifier, attempt.verifier);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('concurrent refreshes serialize across independent stores; refresh rotation and omitted scope persist together', async () => {
  const dir = temporary(); let calls = 0;
  try {
    const store = await savedStore(dir), saved = store.read()!; saved.accounts.oaiapp_fixture!.expiresAt = Date.now(); store.write(saved);
    const request = async (_url: string, options?: RequestInit) => {
      calls++; const form = new URLSearchParams(String(options?.body));
      assert.equal(form.get('refresh_token'), 'fixture-refresh'); assert.equal(form.get('scope'), null);
      await new Promise(resolve => setTimeout(resolve, 20));
      return json({ access_token: 'fixture-access-2', refresh_token: 'fixture-refresh-2', token_type: 'Bearer', expires_in: 3600 });
    };
    const result = await Promise.all([new ChatGptAuth(store, request).accessToken(), new ChatGptAuth(new CredentialStore(dir), request).accessToken()]);
    assert.deepEqual(result, ['fixture-access-2', 'fixture-access-2']); assert.equal(calls, 1);
    assert.equal(store.read()!.accounts.oaiapp_fixture!.refreshToken, 'fixture-refresh-2');
    assert.deepEqual(store.read()!.accounts.oaiapp_fixture!.scopes, scopes);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('temporary refresh errors preserve tokens; revoked refresh clears secrets but preserves registration and host', async () => {
  const dir = temporary();
  try {
    const store = await savedStore(dir), saved = store.read()!; saved.accounts.oaiapp_fixture!.expiresAt = Date.now(); store.write(saved);
    await assert.rejects(new ChatGptAuth(store, async () => json({}, 503)).accessToken(), AiError);
    assert.equal(store.read()!.accounts.oaiapp_fixture!.refreshToken, 'fixture-refresh');
    await assert.rejects(new ChatGptAuth(store, async () => json({ error: 'invalid_grant' }, 400)).accessToken(), AiError);
    assert.equal(store.read()!.accounts.oaiapp_fixture!.refreshToken, undefined); assert.equal(store.read()!.hostId, saved.hostId);
    assert.equal(store.read()!.accounts.oaiapp_fixture!.clientId, 'oaiapp_fixture');
    const active = store.read()!; active.accounts.oaiapp_fixture = { ...account(), scopes: ['openid'] }; store.write(active);
    await assert.rejects(new ChatGptAuth(store, async () => { throw Error('inference must not happen'); }).accessToken(), AiError);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('idle subscription maintenance renews an existing session without inference and leaves unsigned hosts alone', async () => {
  const dir = temporary(); let refreshes = 0;
  try {
    const store = new CredentialStore(dir); await store.initialize();
    const auth = new ChatGptAuth(store, async url => {
      assert.ok(url.endsWith('/oauth/token')); refreshes++;
      return json({ access_token: 'fixture-new-access', refresh_token: 'fixture-new-refresh', token_type: 'Bearer', expires_in: 3600 });
    });
    assert.equal(await auth.maintain(), false); assert.equal(refreshes, 0);
    const saved = store.read()!; saved.accounts.oaiapp_fixture = { ...account(), expiresAt: 0 }; saved.active = 'oaiapp_fixture'; store.write(saved);
    assert.equal(await auth.maintain(), true); assert.equal(await auth.maintain(), true); assert.equal(refreshes, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('headless browser flow listens only on loopback and serves hints privately rather than logging authorization URLs', async () => {
  const dir = temporary();
  try {
    const auth = new ChatGptAuth(new CredentialStore(dir), async () => json({}, 400));
    const flow = await startSignIn(auth, { port: 0 });
    const address = flow.server.address(); assert.ok(address && typeof address === 'object'); assert.equal(address.address, '127.0.0.1');
    const response = await fetch(flow.url, { redirect: 'manual' });
    const authorization = new URL(response.headers.get('location')!); assert.equal(authorization.origin, issuer);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, error: 'access_denied' }).toString();
    const done = assert.rejects(flow.done, AiError);
    assert.equal((await fetch(callback)).status, 400); await done;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Responses uses supported array input, stream/store flags, strict JSON, persistent caching and sanitized logs', async () => {
  const dir = temporary(), dbFile = path.join(dir, 'cache.sqlite'); let calls = 0; const logs: unknown[] = [];
  const options = { model: 'fixture-mini', version: 'test-v1', instructions: 'Return only supplied facts.', input: 'private input never logged',
    format: { name: 'fixture', schema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } } } };
  const request = async (_url: string, init?: RequestInit) => {
    calls++; const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true); assert.equal(body.store, false); assert.ok(Array.isArray(body.input));
    assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'store', 'stream', 'text']);
    assert.equal(body.text.format.strict, true); return sse(completed({ title: 'Wörter und Gefühle' }));
  };
  let db = new Database(dbFile);
  try {
    const auth = { accessToken: async () => 'fixture-access' };
    assert.deepEqual(await new AiService(db, auth, request, value => logs.push(value)).structured(options), { title: 'Wörter und Gefühle' });
    db.close(); db = new Database(dbFile);
    assert.deepEqual(await new AiService(db, { accessToken: async () => { throw Error('cache must be offline'); } }, request).structured(options), { title: 'Wörter und Gefühle' });
    assert.equal(calls, 1); assert.ok(!JSON.stringify(logs).includes('private input')); assert.ok(!JSON.stringify(logs).includes('fixture-access'));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('malformed, refused or interrupted successful streams are cached without a second classification', async () => {
  const candidate: ClassifiedCandidate = { sourceId: 'fixture1234', showId: 'miss-josi', sourceUrl: 'https://www.youtube.com/watch?v=fixture1234',
    title: 'Learn words', description: 'Words for toddlers', descriptionLanguage: 'de', language: 'de', durationMs: 1000000, size: 100,
    components: [], available: true, compilation: false, format: 'episode' };
  for (const response of [sse(completed({ rank: 'A+' })), sse({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }),
    new Response(event({ type: 'response.created' }), { headers: { 'content-type': 'text/event-stream' } })]) {
    const db = new Database(':memory:'); let calls = 0;
    try {
      const ai = new AiService(db, { accessToken: async () => 'fixture-access' }, async () => { calls++; return response; });
      const first = await new EducationalClassifier(db).classify(candidate, 'Miss Josi', { metadataModel: 'fixture-mini' }, undefined, async () => { throw Error(); }, ai);
      assert.equal(first.rank, 'C');
      const next = await new EducationalClassifier(db).classify(candidate, 'Miss Josi', { metadataModel: 'fixture-mini' }, undefined, async () => { throw Error(); }, ai);
      assert.equal(next.rank, 'C'); assert.equal(calls, 1);
    } finally { db.close(); }
  }
  assert.equal((await consumeResponse(new Response('unexpected body'))).status, 'incomplete');
});

test('rate/service retry is bounded, allowance errors persist pause without paid fallback, admission errors are sanitized', async () => {
  const db = new Database(':memory:'); const options = { model: 'fixture-mini', version: '1', instructions: 'Return JSON', input: 'fixture' };
  let calls = 0; const waits: number[] = [];
  try {
    const ai = new AiService(db, { accessToken: async () => 'fixture-access' }, async () => {
      calls++; return calls < 3 ? json({ error: { code: 'rate_limit_exceeded' } }, 429, { 'retry-after': '1' }) : sse(completed({ ok: true }));
    }, () => {}, async ms => { waits.push(ms); });
    assert.equal((await ai.respond(options)).status, 'completed'); assert.equal(calls, 3); assert.deepEqual(waits, [1000, 2000]);
    const limit = new AiService(db, { accessToken: async () => 'fixture-access' }, async () => {
      calls++; return json({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private provider text' } }, 429);
    });
    await assert.rejects(limit.respond({ ...options, input: 'new' }), (e: unknown) => e instanceof AiError && e.kind === 'allowance' && !e.message.includes('private'));
    assert.equal(calls, 4);
    await assert.rejects(new AiService(db, { accessToken: async () => { throw Error('must stay paused'); } }).respond({ ...options, input: 'another' }), AiError);
    assert.equal(calls, 4);
    // Previously successful cached work remains usable during pause.
    assert.equal((await ai.respond(options)).status, 'completed');
  } finally { db.close(); }
});

test('account model discovery selects a listed small model, preserves server order and never escalates', async () => {
  const db = new Database(':memory:'); let calls = 0;
  try {
    const ai = new AiService(db, { accessToken: async () => 'fixture-access' }, async (url, options) => {
      calls++;
      if (url.endsWith('/models')) return json({ models: [{ slug: 'large-pro', visibility: 'list' }, { slug: 'first-mini', visibility: 'list' }, { slug: 'second-nano', visibility: 'list' }] });
      assert.equal(JSON.parse(String(options?.body)).model, 'first-mini'); return sse(completed({ ok: true }));
    });
    await ai.respond({ model: 'auto-small', version: 'v1', instructions: 'JSON', input: 'one' });
    await ai.respond({ model: 'auto-small', version: 'v1', instructions: 'JSON', input: 'two' }); assert.equal(calls, 3);
    db.prepare("DELETE FROM ai_state WHERE key IN ('models','models-at')").run();
    const noSmall = new AiService(db, { accessToken: async () => 'fixture-access' }, async () => json({ models: [{ slug: 'large-pro', visibility: 'list' }] }));
    await assert.rejects(noSmall.respond({ model: 'auto-small', version: 'v1', instructions: 'JSON', input: 'three' }), AiError);
  } finally { db.close(); }
});

test('reusable structured validation rejects additional fields once and never repeats invalid successful output', async () => {
  const db = new Database(':memory:'); let calls = 0;
  try {
    const ai = new AiService(db, { accessToken: async () => 'fixture-access' }, async () => { calls++; return sse(completed({ title: 'Valid title', extra: true })); });
    const options = { model: 'fixture-mini', version: 'v1', instructions: 'JSON', input: 'fixture',
      format: { name: 'test', schema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } } } };
    await assert.rejects(ai.structured(options), (e: unknown) => e instanceof AiError && e.kind === 'output');
    await assert.rejects(ai.structured(options), AiError); assert.equal(calls, 1);
  } finally { db.close(); }
});

test('ChatGPT acquisition classifies once, never reads an API key, and pauses safely on missing consent', async () => {
  const db = new Database(':memory:'); let calls = 0;
  const states = new Map<string, string>(), transitions: unknown[][] = [];
  const row = { id: 'fixture', retryAt: 0, metadata: { sourceId: 'fixture1234', showId: 'miss-josi', sourceUrl: 'https://www.youtube.com/watch?v=fixture1234',
    title: 'Learn words', description: 'Words for toddlers', descriptionLanguage: 'de', language: 'de', durationMs: 1000000, size: 100,
    components: [], available: true, compilation: false, format: 'episode' } as ClassifiedCandidate };
  states.set('youtube-metadata-v1:fixture1234', JSON.stringify({ title: row.metadata.title, description: row.metadata.description, duration: 1000, size: 100 }));
  const service = { db: { db }, app: { projectRoot: '/tmp' }, config: { aiProvider: 'chatgpt', metadataRequestsPerRun: 12, metadataModel: 'fixture-mini' },
    batchDeadline: Infinity, guard: { check() {} }, duplicate: () => undefined, sub: () => ({ editorialClassification: true, title: 'Miss Josi' }),
    store: { candidates: () => [row], state: (key: string) => states.get(key), set: (key: string, value: string) => states.set(key, value),
      remember() {}, transition: (...args: unknown[]) => transitions.push(args) } };
  const helpers = { execute: async () => { throw Error('Metadata cache ignored'); }, request: async () => { throw Error('Paid billing touched'); },
    credential: () => { throw Error('API key must never be read'); }, extractorArgs: () => [],
    ai: new AiService(db, { accessToken: async () => 'fixture-access' }, async url => {
      if (url.endsWith('/models')) return json({ models: [{ slug: 'fixture-mini', visibility: 'list' }] });
      calls++; return sse(completed({ rank: 'A', contentType: 'episode', title: 'Erste Worte', descriptionDe: 'Spielerische Sprachübungen.',
        seasonalTags: [], topics: ['Sprache'], reason: 'Sprachförderung.', ageSuitability: 'toddler', duplicateAssessment: 'no-evidence' }));
    }) };
  try {
    assert.equal(await classifyPending(service, helpers), 1); assert.equal(row.metadata.classification!.rank, 'A');
    assert.equal(row.metadata.classificationModel, 'fixture-mini');
    assert.equal(await classifyPending(service, helpers), 1); assert.equal(calls, 1); assert.equal(transitions.length, 0);
    row.metadata = { ...row.metadata, sourceId: 'newfixture1' }; delete row.metadata.classification; delete row.metadata.classificationVersion;
    states.set('youtube-metadata-v1:newfixture1', states.get('youtube-metadata-v1:fixture1234')!);
    helpers.ai = new AiService(db, { accessToken: async () => { throw new AiError('authentication'); } });
    assert.equal(await classifyPending(service, helpers), 0);
    assert.match(states.get('classification-status')!, /Continue with ChatGPT/); assert.equal(transitions.at(-1)![1], 'deferred');
  } finally { db.close(); }
});

test('sign-out clears only the selected account, preserves client mapping and reports unconfirmed revocation', async () => {
  const dir = temporary();
  try {
    const store = await savedStore(dir); const saved = store.read()!;
    saved.accounts.other = { ...account(), clientId: 'other' }; store.write(saved);
    const auth = new ChatGptAuth(store, async () => json({}, 503));
    assert.equal(await auth.signOut('oaiapp_fixture'), false);
    assert.equal(store.read()!.accounts.other!.accessToken, 'fixture-access'); assert.equal(store.read()!.accounts.oaiapp_fixture!.accessToken, undefined);
    assert.equal(store.read()!.hostId, saved.hostId); assert.equal(store.read()!.active, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
