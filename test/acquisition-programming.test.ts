import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LkpDatabase } from '../src/database.js';
import { buildScheduleEntries, rebuildFutureSchedule, validateTimeline } from '../src/schedule.js';
import { programmeEligible, programmeRotation } from '../src/acquisition/programming.js';
import { config, item } from './helpers.js';
import type { MediaItem } from '../src/types.js';

const educational = (show: string, id: number, durationMs = 1200000, tags: string[] = []): MediaItem => ({ ...item(show, id, durationMs),
  technical: { acquisition: { source: 'youtube', sourceId: `source-${show}-${id}`, publishedAt: Date.UTC(2025, 0, id),
    classification: { rank: 'A', contentType: 'episode', title: 'Lernen', descriptionDe: 'Spielerisches Lernen.', topics: [], seasonalTags: tags, reason: 'Lernvideo' } } } });

test('Christmas is retained and favoured in season; routines remain eligible all year', () => {
  const ordinary = educational('miss-josi', 1), christmas = educational('miss-josi', 2, 1200000, ['christmas']);
  const december = Date.UTC(2026, 11, 10), july = Date.UTC(2026, 6, 10);
  assert.ok(programmeEligible(ordinary, july, 'Europe/Prague'));
  assert.ok(programmeEligible(christmas, december, 'Europe/Prague'));
  assert.equal(programmeEligible(christmas, july, 'Europe/Prague'), false);
  assert.deepEqual(programmeRotation([ordinary, christmas], july, 'Europe/Prague'), [ordinary]);
  assert.deepEqual(programmeRotation([ordinary, christmas], december, 'Europe/Prague'), [ordinary, christmas, christmas]);
  assert.equal(christmas.enabled, true);
});

test('compilations and probable repackaging cannot rotate even at A+ or during Christmas', () => {
  const ordinary = educational('ms-rachel', 1);
  const at = Date.UTC(2026, 11, 10);
  for (const classification of [
    { rank: 'A+', contentType: 'compilation', duplicateAssessment: 'no-evidence', seasonalTags: ['christmas'] },
    { rank: 'A+', contentType: 'recap', duplicateAssessment: 'no-evidence', seasonalTags: [] },
    { rank: 'A+', contentType: 'episode', duplicateAssessment: 'probable-repackaging', seasonalTags: [] },
    { rank: 'A+', contentType: 'episode', duplicateAssessment: 'explicit-bundle', seasonalTags: [] },
  ]) {
    const recycled = { ...educational('ms-rachel', 2), technical: { acquisition: { classification } } };
    assert.equal(programmeEligible(recycled, at, 'Europe/Prague'), false);
    assert.deepEqual(programmeRotation([ordinary, recycled], at, 'Europe/Prague'), [ordinary]);
    const entries = buildScheduleEntries([ordinary, recycled], 'no-recycling', at, at + 3600000);
    assert.ok(entries.every(entry => entry.mediaId !== recycled.id));
    assert.deepEqual(validateTimeline(entries), []);
  }
});

test('long educational programmes rotate on weekdays, short songs use ordinary boundaries and no numbers are invented', () => {
  const long = educational('ms-rachel', 1, 90 * 60000), short = educational('miss-josi', 2, 133000);
  delete long.season; delete long.episode; delete short.season; delete short.episode;
  const start = Date.UTC(2026, 9, 8, 8);
  const entries = buildScheduleEntries([long, short], 'learning', start, start + 6 * 3600000);
  assert.ok(entries.some(e => e.mediaId === long.id)); assert.ok(entries.some(e => e.mediaId === short.id));
  assert.ok(entries.every(e => e.season === undefined && e.episode === undefined));
  assert.deepEqual(validateTimeline(entries), []);
});

test('seasonal-only show drops out safely outside Christmas without disabling its catalogue', () => {
  const christmas = educational('christmas-only', 1, 600000, ['christmas']);
  const ordinary = educational('ms-rachel', 2);
  const start = Date.UTC(2026, 6, 10);
  const entries = buildScheduleEntries([christmas, ordinary], 'learning', start, start + 3600000);
  assert.ok(entries.every(e => e.showId === ordinary.showId)); assert.ok(christmas.enabled);
});

test('future regeneration admits both new shows and preserves all past and protected events', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-learning-schedule-')), c = config(root), db = new LkpDatabase(c.storage.database);
  try {
    const start = Date.now() - 3600000;
    db.replaceMedia([item('original', 1, 1200000), item('other', 1, 1200000)]);
    db.insertSchedule(buildScheduleEntries(db.listMedia(), c.schedule.seed, start, start + 3 * 86400000));
    const before = db.listSchedule(start, start + 3 * 86400000), earliest = Date.now() + 15 * 60000;
    db.replaceMedia([...db.listMedia(), educational('miss-josi', 1), educational('ms-rachel', 1)]);
    const rebuilt = rebuildFutureSchedule(db, c, earliest);
    const after = db.listSchedule(start, rebuilt.lastMs + 1), prefix = before.filter(e => e.startsAtMs < rebuilt.startMs);
    assert.ok(rebuilt.startMs >= earliest);
    assert.deepEqual(after.slice(0, prefix.length), prefix);
    assert.ok(after.some(e => e.showId === 'miss-josi')); assert.ok(after.some(e => e.showId === 'ms-rachel'));
    assert.deepEqual(validateTimeline(after), []);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
