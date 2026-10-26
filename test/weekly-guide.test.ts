import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { loadStationConfig } from '../src/channels.js';
import { LkpDatabase } from '../src/database.js';
import { buildWeeklyGuide, groupGuideEntries, guideDescription, guideEpisodeNumbers, guideWeek, selectGuideFeatures, weeklyGuideHtml, type GuideDay } from '../src/weekly-guide.js';
import type { ScheduleEntry } from '../src/types.js';
import { config, item } from './helpers.js';

const root = path.resolve('.');
const app = () => ({ ...config(root), station: loadStationConfig(root)! });
const ms = (value: string) => DateTime.fromISO(value, { zone: 'Europe/Prague' }).toMillis();
function entry(id: string, date: string, profile: 'lkp' | 'ln' = 'lkp', show = id): ScheduleEntry {
  const startsAtMs = ms(date);
  return { id, sequence: startsAtMs, mediaId: id, showId: show, showTitle: `Show ${show}`, episodeTitle: 'Episode',
    description: '', startsAtMs, endsAtMs: startsAtMs + 600_000, durationMs: 600_000, mediaPath: '/unused.mp4',
    subtitleLanguages: [], presentation: { profile, kind: 'programme' } };
}

test('guide uses Monday broadcast dates and civil morning boundaries over both DST changes', () => {
  const c = app();
  const autumn = guideWeek('2026-10-25', c), spring = guideWeek('2026-03-29', c);
  assert.equal(autumn.start.toISODate(), '2026-10-19');
  assert.equal(autumn.end.toFormat('yyyy-MM-dd HH:mm'), '2026-10-26 06:00');
  assert.equal(autumn.end.toMillis() - autumn.start.toMillis(), 169 * 3_600_000);
  assert.equal(spring.end.toMillis() - spring.start.toMillis(), 167 * 3_600_000);
  const days = buildWeeklyGuide([], c, '2026-10-25');
  assert.equal(days[5]!.endsAtMs - days[5]!.startsAtMs, 25 * 3_600_000);
  assert.equal(days[4]!.handover, '20:00');
  assert.equal(days[5]!.handover, '21:00');
  assert.throws(() => guideWeek('2026-02-30', c), /Invalid/);
  assert.throws(() => guideWeek('2026-10-26T22:00', c), /ISO date/);
});

test('after-midnight LN belongs to the preceding day and continuity is excluded without mutating the schedule', () => {
  const c = app();
  const kids = entry('kids', '2026-10-26T19:45');
  const ident = entry('ident', '2026-10-26T20:00', 'ln', 'station-ln'); ident.presentation!.kind = 'handover';
  const night = entry('night', '2026-10-27T00:15', 'ln');
  const next = entry('next', '2026-10-27T06:00');
  const ad = entry('ad', '2026-10-26T19:55', 'lkp', 'lkp-advertising');
  const entries = [next, night, ident, kids, ad];
  const original = JSON.stringify(entries);
  const days = buildWeeklyGuide(entries, c, '2026-10-26');
  assert.deepEqual(days[0]!.kids.map(e => e.id), ['kids']);
  assert.deepEqual(days[0]!.night.map(e => e.id), ['night']);
  assert.deepEqual(days[1]!.kids.map(e => e.id), ['next']);
  assert.equal(JSON.stringify(entries), original);
  const markup = weeklyGuideHtml(days, c, new Map());
  assert.match(markup, /00\.15<sup>\+<\/sup>/);
  assert.doesNotMatch(markup, /data-event="(?:ident|ad)"/);
});

test('unannotated programmes use the configured profile window and a running programme is retained', () => {
  const a = entry('a', '2026-10-26T05:55', 'ln');
  delete a.presentation;
  const b = entry('b', '2026-10-26T21:30'); delete b.presentation;
  const days = buildWeeklyGuide([a, b], app(), '2026-10-26');
  assert.deepEqual(days[0]!.night.map(e => e.id), ['a', 'b']);
  assert.match(weeklyGuideHtml(days, app(), new Map()), /<time>↳<\/time>/);
});

test('feature matching preserves a scarce show and finds seven distinct scheduled highlights', () => {
  const days: GuideDay[] = Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${26 + i}`, startsAtMs: 0, endsAtMs: 0,
    handover: undefined, kids: [], night: [] }));
  days[0]!.kids = [entry('a', '2026-10-26T15:00', 'lkp', 'only'), entry('b', '2026-10-26T16:00', 'lkp', 'other')];
  days[1]!.kids = [entry('c', '2026-10-27T15:00', 'lkp', 'only')];
  for (let i = 2; i < 7; i++) days[i]!.kids = [entry(`id-${i}`, '2026-10-28T15:00', 'lkp', `show-${i}`)];
  selectGuideFeatures(days, 'Europe/Prague');
  assert.equal(new Set(days.map(d => d.feature?.showId)).size, 7);
  assert.equal(days[0]!.feature!.showId, 'other');
  assert.ok(days.every(d => d.kids.some(e => e.id === d.feature!.id)));
});

test('description copy is brief, removes credits, and markup escapes catalogue text', () => {
  assert.equal(guideDescription('Regie: Example Person. Ein kleiner Hund entdeckt die Welt. Darsteller: Someone.'), 'Ein kleiner Hund entdeckt die Welt.');
  assert.ok(guideDescription('Eine sehr lange Beschreibung '.repeat(20)).length <= 110);
  const bad = entry('untrusted', '2026-10-26T15:00'); bad.showTitle = '<script>alert("x")</script>';
  const markup = weeklyGuideHtml(buildWeeklyGuide([bad], app(), '2026-10-26'), app(), new Map());
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /&lt;script&gt;/);
});

test('episode labels preserve every assembled episode, source order, seasons and split parts', () => {
  const e = entry('block', '2026-10-26T15:00');
  const episodes = [item('a', 24), item('a', 25), item('a', 26), item('a', 2), { ...item('a', 1), id: 's2-e1', season: 2 }];
  const catalogue = new Map(episodes.map(m => [m.id, m]));
  e.playoutPlan = { version: 1, programmeEventId: e.id, sourceDurationMs: e.durationMs, durationMs: e.durationMs, segments: [], warnings: [],
    assembly: { slot: '15:00', premiereDate: '2026-10-26', sources: episodes.map(m => ({ mediaId: m.id, fromMs: 0, toMs: m.durationMs })) } };
  assert.equal(guideEpisodeNumbers(e, catalogue), '1/24–26,2,2/1');
  e.playoutPlan.assembly!.sources = [{ mediaId: episodes[0]!.id, fromMs: 0, toMs: 1000, part: 2, parts: 3 }];
  assert.equal(guideEpisodeNumbers(e, catalogue), '1/24·T2/3');
  delete e.playoutPlan;
  e.episode = 12;
  assert.equal(guideEpisodeNumbers(e, new Map()), '12');
  e.season = 0;
  assert.equal(guideEpisodeNumbers(e, new Map()), '0/12');
});

test('unknown episodes are not invented and films never acquire episode numbers', () => {
  const e = entry('unknown', '2026-10-26T15:00');
  assert.equal(guideEpisodeNumbers(e, new Map()), undefined);
  const movie = { ...item('film', 5), id: e.mediaId, technical: { catalogue: { version: 1, kind: 'movie', originalTitle: 'A film' } } };
  e.episode = 5;
  assert.equal(guideEpisodeNumbers(e, new Map([[movie.id, movie]])), undefined);
  delete e.episode;
  e.showId = 'unusualvideos'; e.episodeTitle = 'UNUSUAL MEMES COMPILATION V28';
  assert.equal(guideEpisodeNumbers(e, new Map()), '28');
});

test('only consecutive airings of the same show are grouped, preserving every original event', () => {
  const entries = [entry('a', '2026-10-26T15:00', 'lkp', 'same'), entry('b', '2026-10-26T15:10', 'lkp', 'same'),
    entry('other', '2026-10-26T15:20'), entry('c', '2026-10-26T15:30', 'lkp', 'same'),
    entry('gap', '2026-10-26T15:45', 'lkp', 'same'), entry('night', '2026-10-26T15:55', 'ln', 'same')];
  const before = JSON.stringify(entries);
  const grouped = groupGuideEntries(entries);
  assert.deepEqual(grouped.map(group => group.map(e => e.id)), [['a', 'b'], ['other'], ['c'], ['gap'], ['night']]);
  assert.deepEqual(grouped.flat(), entries);
  assert.equal(JSON.stringify(entries), before);
});

test('grouped airings combine assemblies and individual episodes into ranges in playback order', () => {
  const assembled = entry('assembled', '2026-10-26T15:00', 'lkp', 'a');
  const episodes = [item('a', 1), item('a', 2)];
  const media = new Map(episodes.map(m => [m.id, m]));
  assembled.playoutPlan = { version: 1, programmeEventId: assembled.id, sourceDurationMs: assembled.durationMs,
    durationMs: assembled.durationMs, segments: [], warnings: [], assembly: { slot: '15:00', premiereDate: '2026-10-26',
      sources: episodes.map(m => ({ mediaId: m.id, fromMs: 0, toMs: m.durationMs })) } };
  const third = entry('third', '2026-10-26T15:10', 'lkp', 'a'); third.season = 1; third.episode = 3;
  assert.equal(guideEpisodeNumbers([assembled, third], media), '1/1–3');
  const repeat = { ...third, id: 'repeat', episode: 1 };
  assert.equal(guideEpisodeNumbers([assembled, third, repeat], media), '1/1–3,1');
});

test('a grouped listing keeps the first start, partial subtitles, and a later feature’s exact time', () => {
  const first = entry('first', '2026-10-26T15:00', 'lkp', 'same'); first.season = 1; first.episode = 2;
  const feature = entry('feature', '2026-10-26T15:10', 'lkp', 'same'); feature.season = 1; feature.episode = 3; feature.subtitleLanguages = ['de'];
  const days = buildWeeklyGuide([first, feature], app(), '2026-10-26');
  days[0]!.feature = feature;
  const markup = weeklyGuideHtml(days, app(), new Map());
  assert.equal((markup.match(/data-event=/g) ?? []).length, 1);
  const row = markup.match(/<li class="programme featured"[^>]*>(.*?)<\/li>/)![1]!;
  assert.match(row, /<time>15\.00<\/time>/);
  assert.match(row, /\(1\/2–3\)/);
  assert.match(row, /aria-label="Untertitel teilweise: DE">UT\*/);
  assert.match(markup, /data-events="\[&quot;first&quot;,&quot;feature&quot;\]"/);
  assert.match(markup, /class="feature-label">[^<]*<time>15\.10<\/time>/);
  assert.match(markup, /class="feature-copy">.*?\(1\/3\)/);
});

test('grouping uses the public timeline across hidden continuity but never spans broadcast days', () => {
  const first = entry('first', '2026-10-26T15:00', 'lkp', 'same');
  const ident = entry('ident', '2026-10-26T15:10', 'lkp', 'lkp-intermissions');
  const next = entry('next', '2026-10-26T15:20', 'lkp', 'same');
  const night = entry('night', '2026-10-27T05:50', 'ln', 'same');
  const morning = entry('morning', '2026-10-27T06:00', 'lkp', 'same');
  const days = buildWeeklyGuide([first, ident, next, night, morning], app(), '2026-10-26');
  assert.deepEqual(groupGuideEntries(days[0]!.kids).map(group => group.map(e => e.id)), [['first', 'next']]);
  assert.deepEqual(groupGuideEntries(days[0]!.night).flat().map(e => e.id), ['night']);
  assert.deepEqual(groupGuideEntries(days[1]!.kids).flat().map(e => e.id), ['morning']);
});

test('subtitle icon follows each scheduled programme, including films, and feature numbers match its listing', () => {
  const subtitled = entry('with-subs', '2026-10-26T15:00');
  subtitled.episode = 7; subtitled.season = 2; subtitled.subtitleLanguages = ['de', 'en'];
  const plain = entry('no-subs', '2026-10-26T07:00');
  const film = entry('film', '2026-10-26T22:00', 'ln'); film.subtitleLanguages = ['cs'];
  const markup = weeklyGuideHtml(buildWeeklyGuide([subtitled, plain, film], app(), '2026-10-26'), app(), new Map());
  const row = (id: string) => markup.match(new RegExp(`data-event="${id}"[^>]*>(.*?)</li>`))![1]!;
  assert.match(row('with-subs'), /\(2\/7\)/);
  assert.match(row('with-subs'), /role="img" aria-label="Untertitel: DE, EN"/);
  assert.doesNotMatch(row('no-subs'), /class="subtitles"/);
  assert.match(row('film'), /aria-label="Untertitel: CS"/);
  assert.equal((markup.match(/\(2\/7\)/g) ?? []).length, 2);
});

test('read-only catalogue cannot mutate production data or create a missing database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-readonly-guide-'));
  try {
    const file = path.join(dir, 'catalogue.sqlite');
    const writer = new LkpDatabase(file); writer.insertSchedule([entry('a', '2026-10-26T15:00')]); writer.close();
    const before = fs.readFileSync(file);
    const reader = new LkpDatabase(file, { readonly: true });
    assert.equal(reader.listSchedule(ms('2026-10-26'), ms('2026-10-27')).length, 1);
    assert.throws(() => reader.db.prepare('DELETE FROM schedule_entries').run(), /readonly/);
    reader.close();
    assert.deepEqual(fs.readFileSync(file), before);
    const missing = path.join(dir, 'missing.sqlite');
    assert.throws(() => new LkpDatabase(missing, { readonly: true }));
    assert.equal(fs.existsSync(missing), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
