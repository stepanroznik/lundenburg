import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  AcquisitionCommandError, downloaderFailure, extractorArgs, playlistCandidates,
  recoverCtExtraction, recoverOrfExtraction, discardOrfPlaylistFiles, usesStreamExtractor, validateYoutubeSubscription, applyEpisodeIdentity, preserveEpisodeIdentity,
} from '../src/acquisition/adapters.js';

const subscription = {
  id: 'teletubbies', language: 'en', minDuration: 600, maxDuration: 1800,
  channelId: 'UCOk55dAgB8VnMlhaTEMeX5A',
  urls: ['https://www.youtube.com/playlist?list=PLmdZ3yaBIVIW-OxGcVRCtD63thztEGK4_'],
};

test('retired endpoints and transient extraction failures remain retryable without leaking diagnostics', () => {
  for (const text of [
    'HTTP Error 410: Gone https://example.org/?token=private-value',
    'HTTP Error 403: Forbidden', 'HTTP Error 429: Too Many Requests',
    'Temporary failure in name resolution', 'Unable to extract video id',
  ]) {
    const error = downloaderFailure(text);
    assert.ok(error instanceof AcquisitionCommandError);
    assert.equal(error.permanent, false);
    assert.doesNotMatch(error.message, /private-value|example\.org|token=/);
  }
  assert.equal(downloaderFailure('HTTP Error 410: Gone').httpStatus, 410);
  for (const text of ['not available in your region', 'ČT episode is DRM protected', 'ČT episode is unavailable'])
    assert.equal(downloaderFailure(text).permanent, true);
});

test('ČT explicitly uses the release-local current player extractor', () => {
  assert.deepEqual(extractorArgs('ct', '/release'), ['--plugin-dirs', '/release/tools/yt-dlp-plugins', '--use-extractors', 'LkpCeskaTelevize']);
  assert.ok(extractorArgs('youtube', '/release').includes('deno:/release/runtime/tools/deno/deno'));
  assert.deepEqual(extractorArgs('mediathek', '/release'), []);
});

test('ČT episode numbers match the existing library and survive fresh discovery', () => {
  const candidate: { episode?: number; season?: number } = {};
  applyEpisodeIdentity(candidate, { defaultSeason: 1 }, { episode_number: 5 });
  assert.deepEqual(candidate, { episode: 5, season: 1 });
  const rediscovered: { episode?: number; season?: number } = {};
  preserveEpisodeIdentity(candidate, rediscovered);
  assert.deepEqual(rediscovered, candidate);
  preserveEpisodeIdentity(candidate, { episode: 6, season: 2 });
  const unknown = {};
  applyEpisodeIdentity(unknown, {}, { episode_number: Number.NaN });
  assert.deepEqual(unknown, {});
});

test('playlist ingestion admits individual episodes once and rejects clips, compilations and other channels', () => {
  const episode = { id: 'MLfVGKnBeaI', title: 'Teletubbies: Feeding the Chickens - Full Episode', duration: 1439 };
  const data = { channel_id: subscription.channelId, entries: [
    episode, episode,
    { ...episode, id: '_-Aa_fWD_xE', title: 'Full Episode Clip', duration: 700 },
    { ...episode, id: 'a-8ZhRAGjGE', title: 'Full Episode Compilation' },
    { ...episode, id: 'tZjWDDUSVwU', duration: 7200 },
    { ...episode, id: '2aS2Oq1fWmw', channel_id: 'UCother' },
    { ...episode, id: 'CXUvsGmBsa0', availability: 'private' },
    { ...episode, id: 'SRkE88lhH50', live_status: 'is_live' },
    { id: 'CktZgKyrqF8', title: episode.title },
  ] };
  const result = playlistCandidates(data, subscription);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.sourceUrl, 'https://www.youtube.com/watch?v=MLfVGKnBeaI');
  assert.equal(result[0]?.durationMs, 1439000);
  assert.equal(result[0]?.language, 'en');
  assert.throws(() => playlistCandidates({ ...data, channel_id: 'UCother' }, subscription), /approved channel/);
});

test('playlist source configuration is restricted to an explicit approved channel and canonical playlist', () => {
  validateYoutubeSubscription(subscription);
  for (const url of ['https://www.youtube.com/watch?v=MLfVGKnBeaI', 'https://example.org/playlist?list=PLfoo',
    'https://www.youtube.com/playlist?list=PLfoo&token=secret', 'http://www.youtube.com/playlist?list=PLfoo'])
    assert.throws(() => validateYoutubeSubscription({ ...subscription, urls: [url] }));
  assert.throws(() => validateYoutubeSubscription({ ...subscription, language: 'de' }));
});

test('migration recovers old ČT extractor failures once, preserving real unavailability and other sources', () => {
  const state = new Map<string, string>(), transitioned: string[] = [], reset: unknown[] = [];
  const reason = 'ČT detected episode needs manual acquisition: extractor unavailable or access restricted';
  const store = {
    state: (key: string) => state.get(key), set: (key: string, value: string) => { state.set(key, value); },
    candidates: () => [
      { id: 'recover', metadata: { source: 'ct' }, reason },
      { id: 'unavailable', metadata: { source: 'ct' }, reason: 'source unavailable; manual acquisition required' },
      { id: 'other', metadata: { source: 'mediathek' }, reason },
    ],
    transition: (id: string) => { transitioned.push(id); },
    catalogue: { db: { prepare: () => ({ run: (...values: unknown[]) => { reset.push(...values); } }) } },
  };
  recoverCtExtraction(store);
  recoverCtExtraction(store);
  assert.deepEqual(transitioned, ['recover']);
  assert.deepEqual(reset, ['recover']);
});

test('ORF recovery resets only legacy failures once and leaves valid MP4 files intact', () => {
  const state = new Map<string, string>(), recovered: string[] = [];
  const store = {
    state: (key: string) => state.get(key), set: (key: string, value: string) => { state.set(key, value); },
    candidates: () => [
      { id: 'orf', metadata: { source: 'mediathek', broadcaster: 'ORF' }, reason: 'Repeated processing failures; manual preparation required' },
      { id: 'geo', metadata: { source: 'mediathek', broadcaster: 'ORF' }, reason: 'Downloader geo-restricted; manual acquisition required' },
      { id: 'ard', metadata: { source: 'mediathek', broadcaster: 'ARD' }, reason: 'Acquisition processing failed; retry scheduled' },
    ],
    transition: (id: string) => { recovered.push(id); },
    catalogue: { db: { prepare: () => ({ run() {} }) } },
  };
  recoverOrfExtraction(store); recoverOrfExtraction(store);
  assert.deepEqual(recovered, ['orf']);
  assert.equal(usesStreamExtractor({ source: 'mediathek', broadcaster: 'ORF' }), true);
  assert.equal(usesStreamExtractor({ source: 'mediathek', broadcaster: 'ARD' }), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-orf-playlist-'));
  try {
    fs.writeFileSync(path.join(dir, 'source.mp4'), '#EXTM3U\nvideo.ts');
    fs.writeFileSync(path.join(dir, 'source.mp4.part'), Buffer.from([0, 0, 0, 20, 102, 116, 121, 112]));
    discardOrfPlaylistFiles(dir);
    assert.equal(fs.existsSync(path.join(dir, 'source.mp4')), false);
    assert.equal(fs.existsSync(path.join(dir, 'source.mp4.part')), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
