import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';
import { createPlaybackHealthHandler, observeHlsResponse } from '../src/internet-health.js';

test('playback diagnostics authenticate, reject cross-site input, bound bodies and discard private fields', async t => {
  const records: Record<string, unknown>[] = [];
  const handler = createPlaybackHealthHandler({ authorized: req => req.headers.authorization === 'Basic fixture',
    security() {}, record: entry => records.push(entry) });
  const server = http.createServer((req, res) => {
    if (!handler(req, res, new URL(req.url!, 'http://localhost'))) res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = { Authorization: 'Basic fixture', 'X-LKP-Playback': '1' };
  const request = (body: string, customHeaders = headers) => fetch(origin + '/api/playback-health', { method: 'POST', headers: customHeaders, body });
  assert.equal((await request('{}', {} as typeof headers)).status, 401);
  assert.equal((await request('{}', { Authorization: 'Basic fixture' } as typeof headers)).status, 403);
  assert.equal((await request('{}', { ...headers, 'Sec-Fetch-Site': 'cross-site' } as typeof headers)).status, 403);
  assert.equal((await fetch(origin + '/api/playback-health', { headers })).status, 405);
  const accepted = await request(JSON.stringify({ player: 'cast', event: 'buffering', mediaTime: 42.123456,
    rangeStart: 20, rangeEnd: 65, idleReason: 'ERROR', url: 'private-marker', password: 'private-marker', device: 'private-marker' }));
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get('access-control-allow-origin'), null);
  assert.equal(accepted.headers.get('cache-control'), 'no-store');
  assert.deepEqual(records, [{ message: 'Playback health', player: 'cast', event: 'buffering', mediaTime: 42.123,
    rangeStart: 20, rangeEnd: 65, idleReason: 'ERROR' }]);
  assert.ok(!JSON.stringify(records).includes('private-marker'));
  assert.equal((await request(JSON.stringify({ player: 'cast', event: 'private-marker' }))).status, 400);
  assert.equal((await request('null')).status, 400);
  assert.equal((await request('x'.repeat(2049))).status, 413);
  assert.equal(records.length, 1);
});

test('delivery diagnostics contain no signed paths and distinguish failures from client aborts', () => {
  const entries: Record<string, unknown>[] = [];
  const request = { url: '/cast/private-marker/segment-1.ts' } as http.IncomingMessage;
  const response = Object.assign(new EventEmitter(), { statusCode: 503 }) as unknown as http.ServerResponse;
  observeHlsResponse(request, response, false, entry => entries.push(entry));
  response.emit('finish'); response.emit('close');
  assert.equal(entries.length, 1); assert.equal(entries[0]!.status, 503); assert.equal(entries[0]!.aborted, false);
  const aborted = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as http.ServerResponse;
  observeHlsResponse(request, aborted, true, entry => entries.push(entry)); aborted.emit('close');
  assert.equal(entries[1]!.aborted, true); assert.equal(entries[1]!.media, 'playlist');
  assert.ok(!JSON.stringify(entries).includes('private-marker'));
});
