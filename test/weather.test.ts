import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadWeatherConfig, presenter } from '../src/weather/config.js';
import { mockForecast, normalizeWeather, periodsFor, editionWindow } from '../src/weather/forecast.js';
import { contextText, speechPlan, temperatureText } from '../src/weather/narration.js';
import { alignmentCues, cacheHash, speechParameters, SpeechCache, speechRoot } from '../src/weather/speech.js';
import { assembleEpisode, subtitles } from '../src/weather/episode.js';
import { publishWeather } from '../src/weather/publish.js';
import { LkpDatabase } from '../src/database.js';
import { buildScheduleEntries, validateTimeline } from '../src/schedule.js';
import { config, item } from './helpers.js';
import type { Atom, Edition, Language } from '../src/weather/model.js';

const c = loadWeatherConfig();
const at = new Date('2026-09-21T07:00:00+02:00');
const atom: Atom = { id: 'test', presenter: 'sisi', language: 'de', text: 'Hallo!', period: 'current', purpose: 'greeting' };
test('weather hazards outrank temperature/wind and unknown codes fail closed', () => {
  assert.equal(normalizeWeather(95, 34, 60), 'thunderstorm');
  assert.equal(normalizeWeather(75, -3, 50), 'snow');
  assert.equal(normalizeWeather(0, 32, 5), 'hot');
  assert.equal(normalizeWeather(3, 12, 45), 'windy');
  assert.throws(() => normalizeWeather(1000, 20, 2));
});
test('edition periods, native present wording, future tomorrow, and DST expiry', () => {
  assert.deepEqual(periodsFor('afternoon'), ['current', 'evening', 'tomorrow']);
  assert.deepEqual(periodsFor('evening'), ['current', 'tomorrow']);
  for (const language of ['de', 'cs', 'sk'] as Language[]) {
    for (const edition of ['afternoon', 'evening'] as const) assert.equal(contextText(language, edition, edition), contextText(language, edition, 'current'));
    for (const edition of ['morning', 'afternoon', 'evening'] as Edition[]) assert.match(contextText(language, edition, 'tomorrow'), /morgen|zítra|zajtra/);
  }
  const window = editionWindow('evening', new Date('2026-10-25T18:00:00+01:00'), c);
  assert.equal(window.until.toISO(), '2026-10-26T00:00:00.000+01:00');
});
test('shared raw voice remains distinct through settings, speed, language, and processing', () => {
  assert.equal(presenter('sisi').voiceId, presenter('haluschka').voiceId);
  const parameters = speechParameters(atom, c);
  assert.notEqual(cacheHash(parameters), cacheHash(speechParameters({ ...atom, presenter: 'haluschka' }, c)));
  assert.notEqual(cacheHash(parameters), cacheHash({ ...parameters, processing: { ...parameters.processing, profile: 'changed' } }));
  assert.notEqual(cacheHash(parameters), cacheHash({ ...parameters, speed: .88 }));
  assert.notEqual(cacheHash(parameters), cacheHash({ ...parameters, voiceSettings: { ...parameters.voiceSettings, stability: .1 } }));
  assert.equal(cacheHash({ b: 2, a: 1 }), cacheHash({ a: 1, b: 2 }));
});
test('cache hit never calls provider; aligned mouth shapes follow actual timestamps', async () => {
  const unique = { ...atom, text: `Cache fixture ${process.pid}` };
  const key = cacheHash(speechParameters(unique, c));
  const directory = path.join(speechRoot, key);
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(path.join(directory, 'speech.wav'), 'fixture');
    const asset = { key, audio: `speech/${key}/speech.wav`, duration: 1, cues: [] };
    fs.writeFileSync(path.join(directory, 'asset.json'), JSON.stringify(asset));
    const cache = new SpeechCache(c, 'tts', async () => { throw new Error('Provider must not be called'); });
    assert.deepEqual(await cache.get(unique), asset);
    assert.equal(cache.stats.hits, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  const cues = alignmentCues({ characters: ['m', 'a', 'o'], character_start_times_seconds: [0, .2, .5], character_end_times_seconds: [.2, .5, .9] });
  assert.deepEqual(cues.map(cue => cue.value), ['closed', 'open', 'round']);
  assert.equal(cues[2]!.start, .5);
});
test('copy failures cannot alter facts; edition assembles all presenters and exact subtitles', async () => {
  const forecast = mockForecast('mixed', at, 'morning');
  const base = await speechPlan(forecast, 'morning');
  const failed = await speechPlan(forecast, 'morning', { chooseReaction: async () => { throw new Error('offline'); } });
  const invalid = await speechPlan(forecast, 'morning', { chooseReaction: async () => 'It will be 99 degrees' });
  assert.deepEqual(failed, base);
  assert.deepEqual(invalid, base);
  const episode = await assembleEpisode(forecast, 'morning', base, async () => ({ key: 'fixture', audio: '', duration: 1.25, cues: [] }));
  assert.equal(new Set(episode.beats.map(b => b.presenter)).size, 4);
  assert.equal(episode.beats.filter(b => b.purpose === 'handoff').length, 3);
  assert.equal(episode.beats.at(-1)!.purpose, 'goodbye');
  assert.match(subtitles(episode, 'vtt'), /^WEBVTT\n/);
  assert.ok(episode.beats.every((b, i) => !i || b.from > episode.beats[i - 1]!.from + episode.beats[i - 1]!.frames));
  assert.match(temperatureText('cs', { ...forecast.cities.knurpsi[0]!, temperatureC: -2 }), /mínus 2 stupně/);
});
test('publication inserts once at a future boundary, keeps programmes whole and rejects previews/expired media', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-weather-'));
  const cfg = config(root), db = new LkpDatabase(cfg.storage.database);
  try {
    const start = Date.now() + 300000;
    const entries = buildScheduleEntries([item('a', 1), item('b', 1)], 'seed', start, start + 60000);
    db.insertSchedule(entries);
    const mediaPath = path.join(root, 'weather.mp4'), subtitlePath = path.join(root, 'subtitles.vtt');
    fs.writeFileSync(mediaPath, 'fixture'); fs.writeFileSync(subtitlePath, 'WEBVTT');
    const meta = { id: 'weather-test', title: 'Test', edition: 'morning' as const, generatedAt: new Date().toISOString(), validFrom: new Date(start).toISOString(), validUntil: new Date(start + 600000).toISOString(), durationMs: 5000, mediaPath, subtitlePath, preview: false };
    assert.throws(() => publishWeather({ ...meta, preview: true }, db, cfg, start));
    assert.throws(() => publishWeather({ ...meta, validUntil: new Date(start + 1).toISOString() }, db, cfg, start));
    const added = publishWeather(meta, db, cfg, start);
    assert.equal(added.startsAtMs, start);
    const after = db.listSchedule(start, start + 600000);
    assert.deepEqual(validateTimeline(after), []);
    assert.equal(after[1]!.durationMs, entries[0]!.durationMs);
    assert.equal(after[1]!.startsAtMs, entries[0]!.startsAtMs + 5000);
    assert.throws(() => publishWeather(meta, db, cfg, start));
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
