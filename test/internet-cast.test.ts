import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { CastAccess, createCastHandler } from '../src/internet-cast.js';
import { castPlayerJs } from '../src/internet-cast-player.js';
import { player, playerJs } from '../src/internet-player.js';

test('Cast capabilities expire, reject modification, and are revoked by restart', () => {
  const access = new CastAccess(), now = Date.now();
  const link = access.issue(now), token = link.path.split('/')[2]!;
  assert.ok(access.valid(token, now));
  assert.ok(access.valid(token, link.expiresAt - 1));
  assert.equal(access.valid(token, link.expiresAt), false);
  assert.equal(access.valid(token, now - 1), false);
  assert.equal(access.valid(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'), now), false);
  assert.equal(access.valid('invalid', now), false);
  assert.equal(new CastAccess().valid(token, now), false);
  assert.notEqual(access.issue(now).path, link.path);
});

test('Cast HTTP access stays restricted to signed HLS and supports receiver CORS, HEAD and byte ranges', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-cast-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'master.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4400000,CODECS="avc1.42c028,mp4a.40.2"\nstream.m3u8\n');
  fs.writeFileSync(path.join(directory, 'stream.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nsegment-000000001.ts\n');
  fs.writeFileSync(path.join(directory, 'segment-000000001.ts'), Buffer.from([0x47, 1, 2, 3, 4]));
  const auth = { Authorization: 'Basic test-fixture-only' };
  const authorized = (request: http.IncomingMessage) => request.headers.authorization === auth.Authorization;
  const handle = createCastHandler({ hlsDirectory: directory, authorized, security: () => {} });
  const server = http.createServer((request, response) => {
    if (handle(request, response, new URL(request.url!, 'http://localhost'))) return;
    response.writeHead(authorized(request) ? 404 : 401).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (url: string, options?: RequestInit) => fetch(new URL(url, origin), options);
  assert.equal((await request('/api/cast', { method: 'POST' })).status, 401);
  assert.equal((await request('/api/cast', { headers: auth })).status, 405);
  assert.equal((await request('/api/cast', { method: 'POST', headers: auth })).status, 403);
  assert.equal((await request('/api/cast', { method: 'POST', headers: { ...auth, 'X-LKP-Cast': '1', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const issued = await request('/api/cast', { method: 'POST', headers: { ...auth, 'X-LKP-Cast': '1' } });
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get('access-control-allow-origin'), null);
  assert.equal(issued.headers.get('cache-control'), 'no-store');
  const link = await issued.json() as { path: string };
  const playlist = await request(link.path, { headers: { Origin: 'https://www.gstatic.com' } });
  assert.equal(playlist.status, 200);
  assert.equal(playlist.headers.get('access-control-allow-origin'), '*');
  assert.equal(playlist.headers.get('content-type'), 'application/vnd.apple.mpegurl');
  const masterText = await playlist.text();
  assert.match(masterText, /CODECS="avc1\.42c028,mp4a\.40\.2"/);
  const mediaPlaylistUrl = new URL(masterText.split('\n').find(line => line.endsWith('.m3u8'))!, new URL(link.path, origin));
  assert.equal(mediaPlaylistUrl.pathname.split('/')[2], link.path.split('/')[2]);
  const mediaPlaylist = await request(mediaPlaylistUrl.href);
  assert.equal(mediaPlaylist.status, 200);
  assert.equal(mediaPlaylist.headers.get('cache-control'), 'no-store');
  const segmentName = (await mediaPlaylist.text()).split('\n').find(line => line.endsWith('.ts'))!;
  const segment = new URL(segmentName, new URL(link.path, origin));
  assert.equal((await request(segment.href)).status, 200);
  const head = await request(segment.href, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '5');
  assert.equal(head.headers.get('cache-control'), 'no-store');
  assert.equal((await head.text()).length, 0);
  const ranged = await request(segment.href, { headers: { Range: 'bytes=1-3' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 1-3/5');
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), Buffer.from([1, 2, 3]));
  const suffix = await request(segment.href, { headers: { Range: 'bytes=-2' } });
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), Buffer.from([3, 4]));
  for (const range of ['bytes=99-', 'bytes=3-1', 'bytes=-0', 'bytes=0-1,3-4']) {
    assert.equal((await request(segment.href, { headers: { Range: range } })).status, 416);
  }
  const preflight = await request(segment.href, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Range');
  assert.equal((await request(link.path, { method: 'POST' })).status, 405);
  assert.equal((await request(new URL('segment-999.ts', new URL(link.path, origin)).href)).status, 404);
  assert.equal((await request(new URL('credentials.env', new URL(link.path, origin)).href)).status, 403);
  assert.equal((await request('/cast/invalid/stream.m3u8')).status, 403);
  assert.equal((await request('/hls/stream.m3u8')).status, 401);
  assert.equal((await request('/api/programme')).status, 401);
});

function browser() {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { hidden: true, textContent: '', listeners: new Map(), addEventListener(type: string, fn: Function) { this.listeners.set(type, fn); } });
    return elements.get(id);
  };
  const reports: any[] = [];
  const events: any[] = [], listeners = new Map<string, Function>();
  const remoteListeners = new Map<string, Function>();
  let remote: any;
  let session: any, loadRequest: any, fetchCount = 0, fail = false, pickerCalls = 0, pickerError: unknown;
  const castContext = {
    setOptions() {}, getCastState: () => 'none', getCurrentSession: () => session,
    requestSession: () => { pickerCalls++; return pickerError ? Promise.reject(pickerError) : Promise.resolve(); },
    addEventListener: (event: string, listener: Function) => listeners.set(event, listener),
    endCurrentSession: () => { session = undefined; listeners.get('session')!({ sessionState: 'ended' }); },
  };
  const context: any = {
    lkpReportPlayback: (sample: any) => reports.push(sample), URL, location: { origin: 'https://stream.example.test' },
    document: { getElementById: element },
    CustomEvent: class { constructor(public type: string, public detail: any) { Object.assign(this, detail); } },
    dispatchEvent: (event: any) => events.push(event),
    fetch: async () => { fetchCount++; return { ok: !fail, json: async () => ({ path: '/cast/test-capability/stream.m3u8' }) }; },
    chrome: { cast: { AutoJoinPolicy: { ORIGIN_SCOPED: 'origin' }, media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: 'default', StreamType: { LIVE: 'LIVE' }, HlsSegmentFormat: { TS: 'TS' }, HlsVideoSegmentFormat: { MPEG2_TS: 'MPEG2_TS' },
      MediaInfo: class { constructor(public contentId: string, public contentType: string) {} },
      GenericMediaMetadata: class {}, LoadRequest: class { constructor(public media: any) {} },
    } } },
    cast: { framework: {
      CastContext: { getInstance: () => castContext }, CastState: { NO_DEVICES_AVAILABLE: 'none' },
      CastContextEventType: { SESSION_STATE_CHANGED: 'session', CAST_STATE_CHANGED: 'state' },
      SessionState: { SESSION_STARTED: 'started', SESSION_RESUMED: 'resumed', SESSION_ENDED: 'ended', SESSION_START_FAILED: 'failed' },
      RemotePlayer: class { isMediaLoaded = true; constructor() { remote = this; } }, RemotePlayerController: class { addEventListener(name: string, fn: Function) { remoteListeners.set(name, fn); } playOrPause() {} },
      RemotePlayerEventType: { IS_PAUSED_CHANGED: 'paused', IS_MEDIA_LOADED_CHANGED: 'loaded', PLAYER_STATE_CHANGED: 'playerState' },
    } },
  };
  context.window = context;
  vm.runInNewContext(castPlayerJs, context);
  return { context, events, element, reports, receiverState(value: string) { remote.playerState = value; remoteListeners.get('playerState')!(); }, mediaLoaded(value: boolean) { remote.isMediaLoaded = value; remoteListeners.get('loaded')!(); }, get request() { return loadRequest; }, get fetches() { return fetchCount; },
    get pickerCalls() { return pickerCalls; }, set pickerError(value: unknown) { pickerError = value; },
    async connect(resumed = false, failure = false) {
      fail = failure;
      session = { getCastDevice: () => ({ friendlyName: 'Living room' }),
        getMediaSession: () => resumed ? { media: { contentId: 'https://stream.example.test/cast/existing/stream.m3u8' } } : null,
        loadMedia: async (request: any) => { loadRequest = request; } };
      listeners.get('session')!({ sessionState: resumed ? 'resumed' : 'started' });
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test('Cast sender loads LIVE MPEG-TS HLS, suspends local playback, and resumes after disconnect', async () => {
  const b = browser();
  b.context.__onGCastApiAvailable(true);
  await b.connect();
  assert.equal(b.request.media.contentType, 'application/vnd.apple.mpegurl');
  assert.equal(b.request.media.streamType, 'LIVE');
  assert.equal(b.request.media.hlsSegmentFormat, 'TS');
  assert.equal(b.request.media.hlsVideoSegmentFormat, 'MPEG2_TS');
  assert.equal(new URL(b.request.media.contentId).origin, 'https://stream.example.test');
  assert.equal(b.events.at(-1).detail.active, true);
  assert.equal(b.element('cast-remote').hidden, false);
  b.element('cast-stop').listeners.get('click')();
  assert.equal(b.events.at(-1).detail.active, false);
  assert.equal(b.element('cast-remote').hidden, true);
});

test('device chooser remains available without background discovery and reports permission and discovery errors', async () => {
  const b = browser();
  b.context.__onGCastApiAvailable(true);
  assert.equal(b.element('cast-find').disabled, false);
  assert.match(b.element('cast-hint').textContent, /Tap Find Chromecast/);
  const click = b.element('cast-find').listeners.get('click');
  const pending = click();
  assert.equal(b.pickerCalls, 1, 'picker must open within the click gesture before any asynchronous work');
  assert.equal(b.fetches, 0, 'media access must not be fetched before selecting a receiver');
  await pending;
  for (const [error, message] of [
    ['cancel', /cancelled/], ['receiver_unavailable', /Chrome found no Chromecast/],
    [{ name: 'NotAllowedError' }, /Chrome blocked device discovery/], ['timeout', /timed out/],
    ['unknown', /could not open/],
  ] as const) {
    b.pickerError = error;
    await click();
    assert.match(b.element('cast-hint').textContent, message);
    assert.equal(b.element('cast-find').disabled, false);
  }
});

test('Cast session resumes without interrupting TV playback and reports authorization failures', async () => {
  const resumed = browser();
  resumed.context.__onGCastApiAvailable(true);
  await resumed.connect(true);
  assert.equal(resumed.fetches, 0);
  assert.equal(resumed.events.at(-1).detail.active, true);
  const failed = browser();
  failed.context.__onGCastApiAvailable(true);
  await failed.connect(false, true);
  assert.equal(failed.events.at(-1).detail.active, true, 'browser stays suspended until the failed TV session is disconnected');
  assert.match(failed.element('cast-hint').textContent, /Could not start casting/);
  const unsupported = browser();
  unsupported.context.__onGCastApiAvailable(false);
  assert.match(unsupported.element('cast-hint').textContent, /unavailable/);
});

test('local player suspends retries while casting and reloads live playback on return', () => {
  const listeners = new Map<string, Function>();
  let plays = 0, pauses = 0, loads = 0;
  const video = { src: '', muted: true, paused: false, currentTime: 0,
    canPlayType: () => true, addEventListener() {}, removeAttribute() {},
    play: () => { plays++; return Promise.resolve(); }, pause: () => { pauses++; }, load: () => { loads++; } };
  const element = { textContent: '' };
  const context: any = { document: { getElementById: (id: string) => id === 'video' ? video : element },
    setInterval() {}, setTimeout() {}, clearTimeout() {}, Date, Intl,
    fetch: async () => ({ ok: true, json: async () => ({ now: null, next: null, stale: true }) }),
    addEventListener: (type: string, fn: Function) => listeners.set(type, fn) };
  context.window = context;
  vm.runInNewContext(playerJs, context);
  listeners.get('lkp-cast-state')!({ detail: { active: true } });
  assert.equal(pauses, 1);
  vm.runInNewContext('restartNative();play();rebuild();online()', context);
  assert.equal(plays, 0);
  assert.equal(loads, 1, 'clearing the browser media cancels pending downloads');
  listeners.get('lkp-cast-state')!({ detail: { active: false } });
  assert.equal(plays, 1);
  assert.equal(loads, 2);
  assert.ok(player.indexOf('/cast.js') < player.indexOf('https://www.gstatic.com/cv/'));
});

test('Cast loading and transient unloaded signals never restart browser playback', async () => {
  const b = browser(); b.context.__onGCastApiAvailable(true);
  let finish: Function = () => {};
  b.context.fetch = () => new Promise(resolve => { finish = resolve; });
  await b.connect();
  assert.equal(b.events.at(-1).detail.active, true, 'local playback stops before the receiver load finishes');
  b.mediaLoaded(false);
  assert.equal(b.events.every(event => event.detail.active), true);
  finish({ ok: true, json: async () => ({ path: '/cast/test/stream.m3u8' }) });
  await new Promise(resolve => setImmediate(resolve));
  b.mediaLoaded(false); b.mediaLoaded(true);
  assert.equal(b.events.every(event => event.detail.active), true);
  b.element('cast-stop').listeners.get('click')();
  assert.equal(b.events.at(-1).detail.active, false);
});

test('casting destroys MSE and blocks local play attempts until disconnect', () => {
  const listeners = new Map<string, Function>(), videoEvents = new Map<string, Function>();
  let destroyed = 0, instances = 0, pauses = 0, loads = 0, removed = 0;
  const video = { src: '', muted: true, paused: false, currentTime: 0, autoplay: true, controls: true,
    canPlayType: () => '', addEventListener: (name: string, fn: Function) => videoEvents.set(name, fn),
    play: () => Promise.resolve(), pause() { pauses++; }, load() { loads++; }, removeAttribute(name: string) { assert.equal(name, 'src'); removed++; } };
  class Hls {
    static isSupported = () => true; static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error', FRAG_LOADED: 'fragment' };
    static ErrorTypes = { MEDIA_ERROR: 'media' };
    constructor() { instances++; } loadSource() {} attachMedia() {} on() {} destroy() { destroyed++; }
  }
  const context: any = { Hls, document: { getElementById: (id: string) => id === 'video' ? video : { textContent: '' } },
    Date, Intl, setInterval() {}, setTimeout() {}, clearTimeout() {},
    addEventListener: (name: string, fn: Function) => listeners.set(name, fn),
    fetch: async () => ({ ok: true, json: async () => ({ now: null, next: null, stale: true }) }) };
  context.window = context; vm.runInNewContext(playerJs, context);
  assert.equal(instances, 1);
  listeners.get('lkp-cast-state')!({ detail: { active: true } });
  assert.equal(destroyed, 1); assert.equal(removed, 1); assert.equal(loads, 1);
  assert.equal(video.autoplay, false); assert.equal(video.controls, false);
  const before = pauses; videoEvents.get('play')!(); videoEvents.get('playing')!();
  assert.equal(pauses, before + 2);
  vm.runInNewContext('play();rebuild();restartNative()', context);
  assert.equal(instances, 1); assert.equal(loads, 1);
  listeners.get('lkp-cast-state')!({ detail: { active: false } });
  assert.equal(instances, 2); assert.equal(video.controls, true);
});

test('receiver state diagnostics observe buffering and recovery without seeking or reloading', async () => {
  const b = browser(); b.context.__onGCastApiAvailable(true); await b.connect(true);
  const fetches = b.fetches;
  b.receiverState('BUFFERING'); b.receiverState('PLAYING'); b.receiverState('PAUSED');
  assert.deepEqual(b.reports.slice(-3).map(sample => sample.event), ['buffering', 'playing', 'paused']);
  assert.equal(b.fetches, fetches);
  assert.ok(b.events.every(event => event.detail.active));
  assert.ok(!JSON.stringify(b.reports).includes('/cast/'));
});
