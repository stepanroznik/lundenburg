import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { finished } from 'node:stream/promises';
import { test } from 'node:test';
import { TransportPacer } from '../src/transport.js';

test('a wall clock correction cannot burst or stall paced transport', async t => {
  const start = Date.now(), monotonic = performance.now();
  let correction = 0;
  t.mock.method(Date, 'now', () => start + performance.now() - monotonic + correction);
  const bytes = 188 * 64 * 6;
  const packets = Buffer.alloc(bytes, 0xff);
  for (let offset = 0; offset < bytes; offset += 188) {
    packets[offset] = 0x47; packets[offset + 1] = 0x1f; packets[offset + 2] = 0xff; packets[offset + 3] = 0x10;
  }
  const pacer = new TransportPacer(bytes * 8000 / 200, start);
  const arrivals: number[] = [];
  pacer.on('data', () => { arrivals.push(performance.now()); correction = 10000; });
  pacer.end(packets);
  await finished(pacer);
  const elapsed = performance.now() - monotonic;
  assert.ok(elapsed >= 180 && elapsed < 1000, `200ms transport took ${elapsed}ms`);
  assert.equal(arrivals.length, 6);
  for (let index = 1; index < arrivals.length; index++) assert.ok(arrivals[index]! - arrivals[index - 1]! >= 15);
});
