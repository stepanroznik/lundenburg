import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { generateEpgXml } from '../src/epg.js';
import { watchEpg } from '../src/epg-refresh.js';
import { LkpDatabase } from '../src/database.js';
import { buildScheduleEntries } from '../src/schedule.js';
import { config, item } from './helpers.js';

const compiler = spawnSync('tstabcomp', ['--version'], { stdio: 'ignore' }).status === 0;
const decode = (value: string) => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');

test('long multilingual descriptions survive numbered DVB descriptors intact', () => {
  const c = config('/tmp/lkp-epg');
  const media = { ...item('a', 1), description: 'Čápi, Grüße, Wörter 😊 — <&> '.repeat(30) + 'Das Ende.' };
  const entry = buildScheduleEntries([media], 'epg', Date.UTC(2026, 9, 11), Date.UTC(2026, 9, 11) + 1)[0]!;
  const output = generateEpgXml([entry], c);
  const parts = [...output.matchAll(/<extended_event_descriptor[^>]*descriptor_number="(\d+)" last_descriptor_number="(\d+)"[^>]*>\s*<text>(.*?)<\/text>/gs)];
  assert.ok(parts.length > 1);
  assert.equal(parts.map(part => decode(part[3]!)).join(''), 'Staffel 1 · Folge 1. ' + media.description);
  assert.deepEqual(parts.map(part => Number(part[1])), parts.map((_part, index) => index));
  assert.ok(parts.every(part => Number(part[2]) === parts.length - 1));
  assert.doesNotMatch(output, /\uFFFD/);
});

test('TSDuck compiles long titles and descriptions in default DVB and UTF-8 encodings', { skip: !compiler }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-epg-compile-'));
  try {
    const c = config(root);
    const media = [
      { ...item('a', 1), showTitle: 'Grüße aus Böhmen', episodeTitle: 'Überraschung für die Kinder', description: 'Äpfel, Bären und Čápi. '.repeat(50) },
      { ...item('b', 1), showTitle: '日本語 😊'.repeat(40), description: 'Wörter, Grüße und Tiere 😊'.repeat(400) },
    ];
    const entries = buildScheduleEntries(media, 'epg', Date.UTC(2026, 9, 11), Date.UTC(2026, 9, 11) + 20000);
    const input = path.join(root, 'epg.xml'); fs.writeFileSync(input, generateEpgXml(entries, c));
    for (const charset of [[], ['--default-charset', 'UTF-8']]) {
      const output = path.join(root, 'epg.bin');
      const result = spawnSync('tstabcomp', [...charset, input, '-o', output], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(fs.statSync(output).size > 0);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('live guide refresh repairs a legacy publication without touching scheduled timing', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-epg-watch-'));
  const c = config(root), db = new LkpDatabase(c.storage.database);
  const at = Date.now(); t.mock.method(Date, 'now', () => at);
  const entries = buildScheduleEntries([item('a', 1)], 'epg', at - 1000, at + 1000);
  db.insertSchedule(entries);
  const before = db.listSchedule(at - 1000, at + 10000);
  const stop = watchEpg(db, c);
  try {
    const expected = fs.readFileSync(c.epg.output, 'utf8');
    fs.writeFileSync(c.epg.output, '<tsduck>Invalid legacy descriptors</tsduck>');
    for (let attempts = 0; attempts < 30 && fs.readFileSync(c.epg.output, 'utf8') !== expected; attempts++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(fs.readFileSync(c.epg.output, 'utf8'), expected);
    assert.deepEqual(db.listSchedule(at - 1000, at + 10000), before);
  } finally { stop(); db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
