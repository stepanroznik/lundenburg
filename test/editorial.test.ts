import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPlayoutPlan, chooseAds, chooseBreakpoints, creditAwareRanges, desiredBreakCount,
  deterministicCharacter, locatePlayoutPosition, scoreBreakSignal,
} from '../src/editorial.js';
import { runEnrichers } from '../src/ingest.js';
import { publicSchedule } from '../src/listing.js';
import { item } from './helpers.js';
import type { AdAsset, AdvertisingConfig, Breakpoint } from '../src/types.js';
import type { RotationClip } from '../src/intermissions/rotation.js';

const policy: AdvertisingConfig = {
  enabled: true, root: '/ads', programmeInterval: 2, minEditorialMinutes: 35,
  targetSeconds: { min: 30, max: 60 }, searchWindowMinutes: 5, minimumBreakpointScore: 12,
  bumperManifest: '/ads/bumpers.json',
};
const ad = (id: string, durationMs = 25_000): AdAsset => ({
  id, title: id, sourceUrl: `https://youtube.com/watch?v=${id}`, language: 'de', durationMs,
  mediaPath: `/ads/${id}.mp4`, enabled: true, tags: [], sourceMetadata: {},
});
const clip: RotationClip = { id: 'ident', title: 'LKP', kind: 'ident', mediaPath: '/intermission.mp4', durationMs: 5_000, languages: ['de'], synopsis: 'LKP' };

test('34-minute programme has no ad break and 36-minute programme has one', () => {
  assert.equal(desiredBreakCount(34 * 60_000), 0);
  assert.equal(desiredBreakCount(36 * 60_000), 1);
});

test('natural breakpoint selection prefers the strongest candidate near its even target', () => {
  const duration = 60 * 60_000;
  const weak = scoreBreakSignal({ atMs: 29 * 60_000, embeddedChapter: true });
  const strong = scoreBreakSignal({ atMs: 31 * 60_000, black: true, silence: true, sceneChange: true });
  assert.deepEqual(chooseBreakpoints([weak, strong], duration), [strong]);
});

test('no acceptable candidate omits the break', () => {
  const poor: Breakpoint = { atMs: 18 * 60_000, score: -25, confidence: 0, reason: ['active dialogue'], source: 'local', enabled: true };
  assert.deepEqual(chooseBreakpoints([poor], 36 * 60_000), []);
});

test('credits shortening preserves mid- and post-credit scenes between multiple credit segments', () => {
  const ranges = creditAwareRanges(400_000, [
    { kind: 'credits', startMs: 100_000, endMs: 200_000, source: 'manual', confidence: 1 },
    { kind: 'post-credits', startMs: 200_000, endMs: 300_000, source: 'manual', confidence: 1 },
    { kind: 'credits', startMs: 300_000, endMs: 400_000, source: 'manual', confidence: 1 },
  ], 'shorten');
  assert.deepEqual(ranges, [
    { type: 'content', fromMs: 0, toMs: 100_000 },
    { type: 'credits', fromMs: 100_000, toMs: 115_000 },
    { type: 'content', fromMs: 200_000, toMs: 300_000 },
    { type: 'credits', fromMs: 300_000, toMs: 315_000 },
  ]);
});

test('ad and WERBUNG character selection are deterministic without immediate ad repetition', () => {
  const inventory = [ad('a'), ad('b'), ad('c')];
  assert.deepEqual(chooseAds(inventory, 'event', 0, 'seed'), chooseAds(inventory, 'event', 0, 'seed'));
  assert.ok(chooseAds(inventory, 'event', 1, 'seed', 'a').every((choice) => choice.id !== 'a'));
  assert.equal(deterministicCharacter('event', 0, 'seed'), deterministicCharacter('event', 0, 'seed'));
});

test('only every other eligible programme gets ads, followed by an LKP intermission, and restart position is exact', () => {
  const media = {
    ...item('film', 1, 36 * 60_000), effectiveEditorialDurationMs: 36 * 60_000,
    creditsPolicy: 'full' as const, breakpoints: [scoreBreakSignal({ atMs: 18 * 60_000, manual: true })],
  };
  const bumpers = (['knurpsi', 'sisi', 'schalinka', 'haluschka'] as const).map((character) => ({ character, mediaPath: `/bumpers/${character}.mp4`, durationMs: 2_500 }));
  const first = buildPlayoutPlan({ eventId: 'first', eventStartMs: 0, media, advertising: policy, ads: [ad('a', 30_000)], bumpers, intermissions: [clip], seed: 'seed', programmeOrdinal: 0 });
  const second = buildPlayoutPlan({ eventId: 'second', eventStartMs: 0, media, advertising: policy, ads: [ad('a', 30_000)], bumpers, intermissions: [clip], seed: 'seed', programmeOrdinal: 1 });
  assert.ok(first.segments.every((segment) => segment.type === 'content'));
  assert.deepEqual(second.segments.map((segment) => segment.type), ['content', 'ad-ident', 'ad', 'intermission', 'content']);
  const adIndex = second.segments.findIndex((segment) => segment.type === 'ad');
  const elapsed = second.segments.slice(0, adIndex).reduce((sum, segment) => sum + segment.durationMs, 0) + 7_000;
  const position = locatePlayoutPosition(second, elapsed)!;
  assert.equal(position.segmentIndex, adIndex);
  assert.equal(position.offsetMs, 7_000);
});

test('missing advertisement asset omits the entire WERBUNG block', () => {
  const media = { ...item('film', 1, 36 * 60_000), effectiveEditorialDurationMs: 36 * 60_000, creditsPolicy: 'full' as const, breakpoints: [scoreBreakSignal({ atMs: 18 * 60_000, manual: true })] };
  const plan = buildPlayoutPlan({ eventId: 'event', eventStartMs: 0, media, advertising: policy, ads: [], bumpers: [], intermissions: [clip], seed: 'seed', programmeOrdinal: 1 });
  assert.ok(plan.segments.every((segment) => segment.type === 'content'));
});


test('public listings hide LKP continuity but preserve visible weather and timeline coverage', () => {
  const ordinary = { id: 'show', sequence: 1, mediaId: 'show', showId: 'show', showTitle: 'Show', episodeTitle: 'Episode', description: '', startsAtMs: 0, endsAtMs: 10_000, durationMs: 10_000, mediaPath: '/show.mp4', subtitleLanguages: [] };
  const intermission = { ...ordinary, id: 'break', sequence: 2, mediaId: 'break', showId: 'lkp-intermissions', showTitle: 'LKP', episodeTitle: 'Internal', startsAtMs: 10_000, endsAtMs: 15_000, durationMs: 5_000, mediaPath: '/break.mp4', listingVisibility: 'hidden' as const };
  const weather = { ...ordinary, id: 'weather', sequence: 3, mediaId: 'weather', showId: 'lkp-weather', showTitle: 'Weather', episodeTitle: 'Forecast', startsAtMs: 15_000, endsAtMs: 20_000, durationMs: 5_000, mediaPath: '/weather.mp4' };
  const visible = publicSchedule([ordinary, intermission, weather]);
  assert.deepEqual(visible.map((entry) => entry.id), ['show', 'weather']);
  assert.equal(visible[0]!.endsAtMs, 15_000);
  assert.equal(visible[0]!.durationMs, 15_000);
});

test('failed optional metadata provider leaves media usable and records QC review', async () => {
  const media = item('a', 1);
  const enriched = await runEnrichers(media, [{ name: 'offline-provider', enrich: async () => { throw new Error('unavailable'); } }]);
  assert.equal(enriched.mediaPath, media.mediaPath);
  assert.equal(enriched.ingestState, 'review');
  assert.match(enriched.qcWarnings!.join(' '), /offline-provider: unavailable/);
});
