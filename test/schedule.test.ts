import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { DateTime } from 'luxon';
import { LkpDatabase } from '../src/database.js';
import { buildScheduleEntries, ensureSchedule, rebuildFutureSchedule, validateTimeline } from '../src/schedule.js';
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
  db.replaceMedia([item('a', 1, 1_800_000), item('b', 1, 1_800_000)]);
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


test('hour-long films rotate once on Saturday evening and repeat Sunday morning across a DST change', () => {
  const c = config('/tmp/lkp-weekend-features');
  c.intermissions = { enabled: true, manifest: '/unused.json', boundaryRate: 1,
    weights: { ident: 1, silent: 0, voiced: 0 } };
  const clips = [{ id: 'ident', title: 'Ident', kind: 'ident' as const,
    mediaPath: '/ident.mp4', durationMs: 5000, languages: ['de'], synopsis: '' }];
  const catalogue = [item('short-a', 1, 20 * 60_000), item('short-b', 1, 25 * 60_000),
    item('film-a', 1, 80 * 60_000), item('film-b', 1, 95 * 60_000)];
  const start = DateTime.fromISO('2026-10-22T00:00', { zone: 'Europe/Prague' }).toMillis();
  const end = DateTime.fromISO('2026-11-03T00:00', { zone: 'Europe/Prague' }).toMillis();
  const entries = buildScheduleEntries(catalogue, 'weekend', start, end, 0, [],
    { config: c, ads: [], clips, bumpers: [] });
  assert.deepEqual(validateTimeline(entries), []);
  assert.ok(entries.some((entry) => entry.showId === 'lkp-intermissions'));
  const films = entries.filter((entry) => entry.showId.startsWith('film-'));
  assert.equal(films.length, 4);
  for (let index = 0; index < films.length; index += 2) {
    const saturday = DateTime.fromMillis(films[index]!.startsAtMs, { zone: 'Europe/Prague' });
    const sunday = DateTime.fromMillis(films[index + 1]!.startsAtMs, { zone: 'Europe/Prague' });
    assert.equal(saturday.weekday, 6);
    assert.ok(saturday.hour >= 18 && saturday.hour < 20);
    assert.equal(sunday.weekday, 7);
    assert.ok(sunday.hour >= 9 && sunday.hour < 11);
    assert.equal(films[index]!.mediaId, films[index + 1]!.mediaId);
  }
  assert.notEqual(films[0]!.mediaId, films[2]!.mediaId);
});

test('future feature rebuild preserves past entries and a gapless timeline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-feature-rebuild-')); temporary.push(root);
  const c = config(root); const db = new LkpDatabase(c.storage.database);
  try {
    const catalogue = [item('short-a', 1, 20 * 60_000), item('short-b', 1, 25 * 60_000),
      item('film', 1, 80 * 60_000)];
    db.replaceMedia(catalogue);
    const start = DateTime.fromISO('2026-10-22T00:00', { zone: 'Europe/Prague' }).toMillis();
    const original = buildScheduleEntries(catalogue, 'weekend', start, start + 10 * 86_400_000);
    db.insertSchedule(original);
    const boundary = db.nextAfter(start + 4 * 3_600_000)!;
    const preserved = db.listSchedule(start, boundary.startsAtMs);
    const result = rebuildFutureSchedule(db, c, start + 4 * 3_600_000);
    const rebuilt = db.listSchedule(start, result.lastMs + 1);
    assert.deepEqual(rebuilt.slice(0, preserved.length), preserved);
    assert.deepEqual(validateTimeline(rebuilt), []);
    assert.equal(rebuilt.filter((entry) => entry.showId === 'film').length, 3);
  } finally { db.close(); }
});
