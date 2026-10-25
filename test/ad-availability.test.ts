import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { adAvailableAt } from '../src/advertising/availability.js';
import { buildPlayoutPlan, chooseAds, scoreBreakSignal } from '../src/editorial.js';
import type { AdAsset, AdvertisingConfig } from '../src/types.js';
import { item } from './helpers.js';

const ms = (date: string) => DateTime.fromISO(date, { zone: 'Europe/Prague' }).toMillis();
const spot = (id: string, durationMs = 30_000): AdAsset => ({
  id, title: id, sourceUrl: `https://example.test/${id}`, language: 'de', durationMs,
  mediaPath: `/${id}.mp4`, enabled: true, tags: ['christmas'], sourceMetadata: {},
});

test('Christmas ads run December 1–25 annually and cannot spill into December 26 in Prague', () => {
  for (const [date, expected] of [
    ['2026-11-30T23:59:59', false], ['2026-12-01T00:00:00', true],
    ['2026-12-25T23:59:30', true], ['2026-12-25T23:59:30.001', false],
    ['2026-12-26T00:00:00', false], ['2027-01-01T12:00:00', false],
    ['2027-12-01T00:00:00', true],
  ] as const) assert.equal(adAvailableAt(spot('x'), ms(date)), expected, date);
  assert.equal(adAvailableAt(spot('x'), Date.parse('2026-11-30T23:00:00Z')), true);
  assert.equal(adAvailableAt({ durationMs: 30_000, tags: [] }, ms('2026-10-25T12:00')), true);
  assert.equal(adAvailableAt(spot('x'), NaN), false);
});

test('ad pods filter disabled/seasonal inventory and validate the second spot at its own start', () => {
  const inventory = [spot('a', 20_000), spot('b', 20_000)];
  assert.equal(chooseAds(inventory, 'event', 0, 'seed', undefined, 60, ms('2026-11-30T12:00')).length, 0);
  assert.equal(chooseAds(inventory, 'event', 0, 'seed', undefined, 60, ms('2026-12-25T23:59:30')).length, 1);
  assert.equal(chooseAds(inventory, 'event', 0, 'seed', undefined, 60, ms('2026-12-25T12:00')).length, 2);
  assert.deepEqual(chooseAds([{ ...spot('x'), enabled: false }], 'event', 0, 'seed', undefined, 60, ms('2026-12-01T12:00')), []);
});

test('embedded breaks use the actual spot time and retain restrictions in persisted plans', () => {
  const media = { ...item('film', 1, 36 * 60_000), creditsPolicy: 'full' as const,
    breakpoints: [scoreBreakSignal({ atMs: 18 * 60_000, manual: true })] };
  const advertising: AdvertisingConfig = { enabled: true, root: '/ads', programmeInterval: 2,
    minEditorialMinutes: 35, targetSeconds: { min: 30, max: 60 }, searchWindowMinutes: 5,
    minimumBreakpointScore: 12, bumperManifest: '/bumpers.json' };
  const bumpers = (['knurpsi', 'sisi', 'schalinka', 'haluschka'] as const)
    .map(character => ({ character, mediaPath: '/bumper.mp4', durationMs: 5_000 }));
  const make = (date: string) => buildPlayoutPlan({ eventId: 'event', eventStartMs: ms(date),
    media, advertising, ads: [spot('x')], bumpers, seed: 'seed', programmeOrdinal: 1 });
  const december = make('2026-11-30T23:50');
  const ad = december.segments.find(segment => segment.type === 'ad');
  assert.ok(ad);
  assert.deepEqual(ad.tags, ['christmas']);
  // A stale plan remains restricted after its serialization/reload, including archive replay.
  const persisted = JSON.parse(JSON.stringify(ad));
  assert.equal(adAvailableAt(persisted, ms('2026-12-26T12:00')), false);
  assert.ok(make('2026-12-25T23:50').segments.every(segment => segment.type !== 'ad'));
  // The five-second WERBUNG ident itself can push an otherwise fitting spot past midnight.
  assert.ok(make('2026-12-25T23:41:27').segments.every(segment => segment.type !== 'ad'));
});
