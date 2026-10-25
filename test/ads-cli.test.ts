import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { LkpDatabase } from '../src/database.js';

test('ads:list shows empty inventory and includes enabled and disabled spots without changing them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-ads-cli-'));
  const database = path.join(root, 'catalogue.sqlite');
  const list = () => {
    const result = spawnSync('npm', ['run', 'ads:list'], {
      encoding: 'utf8', env: { ...process.env, LKP_DATABASE: database },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  let db: LkpDatabase | undefined;
  try {
    assert.match(list(), /0 advertisement\(s\)\./);
    db = new LkpDatabase(database);
    for (const enabled of [true, false]) db.upsertAd({
      id: enabled ? 'active-ad' : 'disabled-ad', title: enabled ? 'Active spot' : 'Disabled spot',
      sourceUrl: `https://example.com/ad-${enabled}`, language: 'de', durationMs: 30_000,
      mediaPath: `/unused/ad-${enabled}.mp4`, enabled, tags: [], sourceMetadata: {},
    });
    const before = db.listAds(false);
    const output = list();
    assert.match(output, /active-ad\t00:00:30\tenabled\tde\tActive spot/);
    assert.match(output, /disabled-ad\t00:00:30\tdisabled\tde\tDisabled spot/);
    assert.match(output, /2 advertisement\(s\)\./);
    assert.deepEqual(db.listAds(false), before);
  } finally {
    db?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
