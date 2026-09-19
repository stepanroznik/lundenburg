import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { LkpDatabase } from '../src/database.js';
import { buildScheduleEntries, ensureSchedule, validateTimeline } from '../src/schedule.js';
import { config, item } from './helpers.js';

const temporary: string[] = [];
after(() => temporary.forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

test('deterministic generation is gapless, ordered, and avoids adjacent shows', () => {
  const catalogue = [item('a', 1), item('a', 2), item('b', 1), item('b', 2), item('c', 1)];
  const first = buildScheduleEntries(catalogue, 'seed', 1_000, 101_000);
  const second = buildScheduleEntries(catalogue, 'seed', 1_000, 101_000);
  assert.deepEqual(first, second);
  assert.deepEqual(validateTimeline(first), []);
  assert.ok(first.every((entry, index) => index === 0 || first[index - 1]!.showId !== entry.showId));
  const episodesA = first.filter((entry) => entry.showId === 'a').map((entry) => entry.episode);
  assert.ok(episodesA.length >= 3);
  assert.ok(episodesA.every((episode, index) => episode === (index % 2) + 1));
});

test('persisted schedule extends without changing existing entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-schedule-')); temporary.push(root);
  const c = config(root); const db = new LkpDatabase(c.storage.database);
  db.replaceMedia([item('a', 1, 3_600_000), item('b', 1, 3_600_000)]);
  const start = Date.UTC(2026, 0, 1);
  ensureSchedule(db, c, { fromMs: start, horizonDays: 1 });
  const before = db.listSchedule(start, Number.MAX_SAFE_INTEGER);
  const unchanged = ensureSchedule(db, c, { fromMs: start, horizonDays: 1 });
  assert.equal(unchanged.added, 0);
  ensureSchedule(db, c, { fromMs: start, horizonDays: 2 });
  const afterEntries = db.listSchedule(start, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(afterEntries.slice(0, before.length), before);
  assert.ok(afterEntries.length > before.length);
  db.close();
});

test('current lookup uses start-inclusive and end-exclusive boundaries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-boundary-')); temporary.push(root);
  const db = new LkpDatabase(path.join(root, 'db.sqlite'));
  const entries = buildScheduleEntries([item('a', 1, 1_470_500), item('b', 1, 1_362_000)], 'seed', 18_000_000, 21_000_000);
  db.insertSchedule(entries);
  const first = entries[0]!; const second = entries[1]!;
  assert.equal(db.currentAt(first.startsAtMs - 1), undefined);
  assert.equal(db.currentAt(first.startsAtMs)?.id, first.id);
  assert.equal(db.currentAt(first.endsAtMs - 1)?.id, first.id);
  assert.equal(db.currentAt(first.endsAtMs)?.id, second.id);
  db.close();
});
