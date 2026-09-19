import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateEpgXml } from '../src/epg.js';
import { logoFrame } from '../src/logo.js';
import { buildScheduleEntries } from '../src/schedule.js';
import { parseDateTime } from '../src/util.js';
import { config, item } from './helpers.js';

test('Europe/Prague date parsing respects both DST transitions', () => {
  const zone = 'Europe/Prague';
  assert.equal(parseDateTime('2026-03-30', zone) - parseDateTime('2026-03-29', zone), 23 * 3_600_000);
  assert.equal(parseDateTime('2026-10-26', zone) - parseDateTime('2026-10-25', zone), 25 * 3_600_000);
});

test('logo transition starts and finishes exactly and stays within zoom', () => {
  const start = logoFrame(0, 1100, 3, 1.08);
  const middle = Array.from({ length: 101 }, (_, i) => logoFrame(i * 11, 1100, 3, 1.08));
  const end = logoFrame(1100, 1100, 3, 1.08);
  assert.equal(start.angleRadians, 0); assert.equal(start.scale, 1);
  assert.ok(Math.abs(end.angleRadians - 6 * Math.PI) < 1e-12);
  assert.ok(Math.abs(end.scale - 1) < 1e-12);
  assert.ok(middle.every((frame) => frame.scale >= 1 && frame.scale <= 1.080000000001));
});

test('EPG represents canonical full event times and descriptions', () => {
  const c = config('/tmp/lkp-test');
  const entry = buildScheduleEntries([item('a', 1, 1_470_500)], 'seed', Date.UTC(2026, 8, 19, 16), Date.UTC(2026, 8, 19, 16, 25))[0]!;
  const xml = generateEpgXml([entry], c);
  assert.match(xml, /start_time="2026-09-19 16:00:00"/);
  assert.match(xml, /duration="00:24:31"/);
  assert.match(xml, /Show a: Episode 1/);
  assert.match(xml, /Episode 1 description/);
});
