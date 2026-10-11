import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { LkpDatabase } from '../src/database.js';
import { writeCatalogue } from '../src/catalogue-maintenance.js';
import { item } from './helpers.js';

test('catalogue migration preserves current events, future times, source identity and manual sidecars', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-catalogue-migration-'));
  const db = new LkpDatabase(path.join(root, 'db.sqlite'));
  try {
    const film = { ...item('movie', 1), technical: { catalogue: { kind: 'movie' } }, mediaPath: path.join(root, 'movie.mp4') };
    fs.writeFileSync(film.mediaPath, 'fixture');
    fs.writeFileSync(path.join(root, 'movie.yaml'), 'season: 1\nepisode: 1\nexternalIds:\n  imdb: tt123\n');
    db.upsertMedia([film]);
    const event = { id: 'current', sequence: 0, mediaId: film.id, showId: film.showId, showTitle: film.showTitle,
      season: 1, episode: 1, episodeTitle: 'Old title', description: 'Old description', startsAtMs: 0, endsAtMs: 1000,
      durationMs: 1000, mediaPath: film.mediaPath, subtitleLanguages: [] };
    db.insertSchedule([event, { ...event, id: 'future', sequence: 1, startsAtMs: 1000, endsAtMs: 2000 }]);
    const before = db.listSchedule(0, 2000);
    writeCatalogue(db, path.join(root, 'backup'), 500);
    const after = db.listSchedule(0, 2000);
    assert.deepEqual(after[0], before[0]);
    assert.equal(after[1]!.id, before[1]!.id);
    assert.equal(after[1]!.startsAtMs, 1000); assert.equal(after[1]!.endsAtMs, 2000);
    assert.equal(after[1]!.episode, undefined); assert.equal(after[1]!.season, undefined);
    const metadata = parse(fs.readFileSync(path.join(root, 'movie.yaml'), 'utf8'));
    assert.equal(metadata.episode, undefined); assert.equal(metadata.season, undefined);
    assert.deepEqual(metadata.externalIds, { imdb: 'tt123' });
    assert.equal(metadata.catalogue.kind, 'movie');
    const repeated = writeCatalogue(db, path.join(root, 'repeat'), 500);
    assert.equal(repeated.changed, 0); assert.equal(repeated.sidecars, 0);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
