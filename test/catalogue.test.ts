import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCatalogue, normalizeCatalogueText, sourceEpisodeNumbers, episodeNumberLabel } from '../src/catalogue.js';
import { item } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LkpDatabase } from '../src/database.js';

test('catalogue removes upload labels without removing meaningful title words', () => {
  const base = { showTitle: 'Teletubbies', episodeTitle: 'Teletubbies: Going for a Walk - Full Episode', description: 'Eine\u00a0Folge.\n' };
  assert.equal(normalizeCatalogueText(base).episodeTitle, 'Going for a Walk');
  assert.equal(normalizeCatalogueText(base).description, 'Eine Folge.');
  assert.equal(normalizeCatalogueText({ ...base, episodeTitle: 'Teletubbies Go Walking' }).episodeTitle, 'Teletubbies Go Walking');
  assert.equal(normalizeCatalogueText({ ...base, episodeTitle: 'Kalli-Wassertropfen | Unser Sandmännchen | 20.09.2026', showTitle: 'Unser Sandmännchen' }).episodeTitle, 'Kalli-Wassertropfen');
});

test('unnumbered episodes keep stable local numbers across rescans and incremental acquisition', () => {
  const first = item('series', 1); delete first.season; delete first.episode;
  const second = { ...first, id: 'second' };
  const initial = normalizeCatalogue([second, first]);
  assert.deepEqual(new Set(initial.map(i => i.episode)), new Set([1, 2]));
  const rescanned = normalizeCatalogue([first, second], initial);
  assert.equal(rescanned[0]!.episode, initial.find(i => i.id === first.id)!.episode);
  const added = normalizeCatalogue([{ ...first, id: 'added' }], initial)[0]!;
  assert.equal(added.episode, 3);
  assert.equal(added.season, undefined);
  assert.deepEqual(sourceEpisodeNumbers(added), {});
  assert.deepEqual(normalizeCatalogue(initial, initial), initial);
});

test('source numbers survive, films lose all numbering, and continuity stays untouched', () => {
  const series = item('series', 7);
  const film = { ...item('film', 1), technical: { catalogue: { kind: 'movie' } } };
  const legacy = item('wreck-it-ralph', 1);
  const continuity = item('lkp-weather', 1);
  const [normalized, movie, oldMovie, weather] = normalizeCatalogue([series, film, legacy, continuity]);
  assert.deepEqual(sourceEpisodeNumbers(normalized!), { season: series.season, episode: 7 });
  for (const m of [movie!, oldMovie!]) { assert.equal(m.episode, undefined); assert.equal(m.season, undefined); }
  assert.deepEqual(weather, continuity);
  assert.equal(episodeNumberLabel(normalized!), 'Staffel 1 · Folge 7');
  assert.equal(episodeNumberLabel(movie!), '');
});

test('only explicit season/episode labels become source numbers; dates remain local identities', () => {
  const unnumbered = item('series', 1); delete unnumbered.season; delete unnumbered.episode;
  const [source, dated] = normalizeCatalogue([
    { ...unnumbered, id: 'source', episodeTitle: 'Apple Pie - Full Episode (S11E275)' },
    { ...unnumbered, id: 'dated', episodeTitle: 'Tolle Tiere vom 20.12.2024' },
  ]);
  assert.deepEqual(sourceEpisodeNumbers(source!), { season: 11, episode: 275 });
  assert.equal(dated!.episode, 276);
  assert.equal(dated!.season, undefined);
  assert.deepEqual(sourceEpisodeNumbers(dated!), {});
});

test('catalogue persistence reuses local numbers on a raw rescan and keeps movie numbers absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-catalogue-'));
  const db = new LkpDatabase(path.join(root, 'catalogue.sqlite'));
  try {
    const raw = item('series', 1); delete raw.season; delete raw.episode;
    const film = item('wreck-it-ralph', 1);
    db.replaceMedia([raw, film]);
    const first = db.listMedia(false).find(i => i.id === raw.id)!;
    const added = { ...raw, id: 'new', mediaPath: '/media/new.mp4' };
    db.upsertMedia([added]);
    db.replaceMedia([raw, film, added]);
    const rows = db.listMedia(false);
    assert.equal(rows.find(i => i.id === raw.id)!.episode, first.episode);
    assert.equal(rows.find(i => i.id === 'new')!.episode, 2);
    assert.equal(rows.find(i => i.id === film.id)!.episode, undefined);
    assert.equal(rows.find(i => i.id === film.id)!.season, undefined);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
