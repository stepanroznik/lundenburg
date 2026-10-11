import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { comingUpCards, comingUpCardX, comingUpEntries, comingUpForPiece, comingUpWindow, comingUpMotion,
  defaultComingUpConfig, validateComingUpConfig, wrapComingUpTitle } from '../src/coming-up.js';
import { buildFfmpegArgs } from '../src/playout.js';
import { LkpDatabase } from '../src/database.js';
import { config } from './helpers.js';
import { comingUpTextWidth } from '../src/coming-up-font.js';
import type { ScheduleEntry } from '../src/types.js';

function programme(i = 0, durationMs = 22 * 60_000): ScheduleEntry {
  return { id: `event-${i}`, sequence: i, mediaId: `media-${i}`, showId: `show-${i}`,
    showTitle: ['Benjamin Blümchen', 'Die Sendung mit der Maus', 'Biene Maja', 'Pettersson und Findus', 'LKP Wetterfreunde'][i % 5]!,
    season: 1, episode: i + 1, episodeTitle: 'Ein schöner Tag', description: '',
    startsAtMs: i * durationMs, endsAtMs: (i + 1) * durationMs, durationMs,
    mediaPath: `/media/${i}.mp4`, subtitleLanguages: [] };
}

test('strict 16-minute threshold, disabled graphics, and hidden continuity', () => {
  assert.equal(comingUpWindow(programme(0, 16 * 60_000), defaultComingUpConfig), undefined);
  assert.deepEqual(comingUpWindow(programme(0, 16 * 60_000 + 1), defaultComingUpConfig), { startMs: 900_001, endMs: 920_001 });
  assert.equal(comingUpWindow(programme(), { ...defaultComingUpConfig, enabled: false }), undefined);
  assert.equal(comingUpWindow({ ...programme(), showId: 'lkp-intermissions' }, defaultComingUpConfig), undefined);
  assert.equal(comingUpWindow({ ...programme(), listingVisibility: 'hidden' }, defaultComingUpConfig), undefined);
  assert.throws(() => validateComingUpConfig({ ...defaultComingUpConfig, durationSeconds: 7 }));
  assert.throws(() => validateComingUpConfig({ ...defaultComingUpConfig, leadSeconds: 19 }));
  assert.throws(() => validateComingUpConfig({ ...defaultComingUpConfig, minProgrammeMinutes: NaN }));
});

test('upcoming panels and database lookup follow public schedule order across hidden continuity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-coming-up-list-'));
  const db = new LkpDatabase(path.join(root, 'schedule.sqlite'));
  try {
    const entries = Array.from({ length: 8 }, (_, i) => programme(i));
    entries[1] = { ...entries[1]!, showId: 'lkp-ads' };
    entries[2] = { ...entries[2]!, showId: 'lkp-weather', listingVisibility: 'hidden' };
    entries[4] = { ...entries[4]!, listingVisibility: 'hidden' };
    entries[5] = { ...entries[5]!, showId: 'lkp-intermissions' };
    db.insertSchedule(entries);
    assert.deepEqual(comingUpEntries(entries[0]!, entries.slice(1).reverse()).map(e => e.id), ['event-0', 'event-2', 'event-3', 'event-6', 'event-7']);
    assert.deepEqual(db.nextPublicEntries(entries[0]!.endsAtMs).map(e => e.id), ['event-2', 'event-3', 'event-6', 'event-7']);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('ads do not qualify a short show, and placement stays inside the terminal content/credits run', () => {
  const entry = programme();
  entry.playoutPlan = { version: 1, programmeEventId: entry.id, sourceDurationMs: 1_320_000,
    durationMs: 1_380_000, warnings: [], segments: [
      { type: 'content', mediaPath: entry.mediaPath, fromMs: 0, toMs: 1_290_000, durationMs: 1_290_000 },
      { type: 'ad', mediaPath: '/ad.mp4', adId: 'ad', durationMs: 60_000 },
      { type: 'content', mediaPath: entry.mediaPath, fromMs: 1_290_000, toMs: 1_305_000, durationMs: 15_000 },
      { type: 'credits', mediaPath: entry.mediaPath, fromMs: 1_305_000, toMs: 1_320_000, durationMs: 15_000 },
    ] };
  entry.durationMs = 1_380_000; entry.endsAtMs = 1_380_000;
  assert.deepEqual(comingUpWindow(entry, defaultComingUpConfig), { startMs: 1_350_000, endMs: 1_370_000 });
  const c = config('/tmp/lkp-test');
  const next = Array.from({ length: 4 }, (_, i) => programme(i + 2));
  assert.equal(comingUpForPiece(entry, 1_365_000, 15_000, next, c)?.startSeconds, -15);
  assert.equal(comingUpForPiece(entry, 1_290_000, 60_000, next, c), undefined);
  entry.playoutPlan.segments[0] = { type: 'content', mediaPath: entry.mediaPath, fromMs: 0, toMs: 900_000, durationMs: 900_000 };
  assert.equal(comingUpWindow(entry, defaultComingUpConfig), undefined);
  entry.playoutPlan.segments[0] = { type: 'content', mediaPath: entry.mediaPath, fromMs: 0, toMs: 1_290_000, durationMs: 1_290_000 };
  entry.playoutPlan.segments.splice(2, 1);
  entry.playoutPlan.durationMs -= 15_000;
  assert.equal(comingUpWindow(entry, defaultComingUpConfig), undefined);
});

test('cold starts preserve animation phase; expired bumpers and incomplete lookahead are omitted', () => {
  const entry = programme();
  const following = Array.from({ length: 4 }, (_, i) => programme(i + 1));
  const c = config('/tmp/lkp-test');
  assert.equal(comingUpForPiece(entry, 0, entry.durationMs, following, c)?.startSeconds, 1260);
  assert.equal(comingUpForPiece(entry, 1_265_000, 55_000, following, c)?.startSeconds, -5);
  assert.equal(comingUpForPiece(entry, 1_280_000, 40_000, following, c), undefined);
  assert.equal(comingUpForPiece(entry, 0, entry.durationMs, following.slice(0, 3), c), undefined);
  assert.equal(comingUpForPiece(programme(0, 16 * 60_000), 0, 16 * 60_000,
    () => { throw new Error('Short shows must not query lookahead'); }, c), undefined);
});

test('five unequal logo panels fill the width, unfold, stack again, and leave the frame', () => {
  const cards = comingUpCards(Array.from({ length: 5 }, (_, i) => programme(i)), 1920, 1080);
  assert.equal(cards.reduce((sum, card) => sum + card.width, 0), 1920);
  assert.equal(new Set(cards.map(card => card.width)).size, 5);
  assert.deepEqual(cards.map(card => card.color), ['#fb1143', '#fd6f04', '#fdbf11', '#79c718', '#02aafd']);
  const foldFinishedAt = 20 - comingUpMotion.foldBeforeEnd + 3 * comingUpMotion.foldStagger + comingUpMotion.fold;
  assert.ok(Math.abs(foldFinishedAt - (20 - comingUpMotion.exitBeforeEnd)) < 1e-9);
  cards.forEach((card, i) => {
    assert.ok(comingUpCardX(0, 20, i, card.left, cards[0]!.width) + card.width < 0);
    assert.equal(comingUpCardX(5, 20, i, card.left, cards[0]!.width), card.left);
    assert.equal(comingUpCardX(foldFinishedAt, 20, i, card.left, cards[0]!.width), 0);
    assert.ok(comingUpCardX(foldFinishedAt + .05, 20, i, card.left, cards[0]!.width) < 0);
    assert.ok(comingUpCardX(20, 20, i, card.left, cards[0]!.width) + card.width < 0);
  });
  assert.equal(wrapComingUpTitle('Die Sendung mit der Maus', 370, 32).length, 2);
  assert.ok(wrapComingUpTitle('Donaudampfschifffahrtsgesellschaftskapitän unterwegs mit seinen Freunden', 180, 32).at(-1)!.endsWith('…'));
  assert.ok(comingUpTextWidth('WWW', 32) > comingUpTextWidth('iii', 32) * 2);
  assert.deepEqual(cards[4]!.lines.slice(1, 3).map(line => line.text), ['LKP', 'Wetterfreunde']);
});

test('real FFmpeg holds finite cards without ending or extending programme audio/video', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-coming-up-ffmpeg-'));
  const run = (args: string[]) => {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { timeout: 30_000, encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  };
  try {
    const c = config(root); c.projectRoot = process.cwd();
    c.video.width = 640; c.video.height = 360; c.video.preset = 'ultrafast';
    c.logo.width = 8; c.logo.left = 20; c.logo.top = 10;
    const mediaPath = path.join(root, 'source.mkv'), logoPath = path.join(root, 'logo.png');
    run(['-f', 'lavfi', '-i', 'color=c=0x213f49:s=640x360:r=30:d=21', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=21', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_s16le', mediaPath]);
    run(['-f', 'lavfi', '-i', 'color=c=white:s=8x8', '-frames:v', '1', '-threads', '1', '-update', '1', logoPath]);
    const entry = { ...programme(), mediaPath };
    const comingUp = comingUpForPiece(entry, 1_260_000, 60_000, Array.from({ length: 4 }, (_, i) => programme(i + 1)), c)!;
    const output = path.join(root, 'encoded.ts');
    const args = buildFfmpegArgs(entry, undefined, 0, Infinity, false, c, { path: logoPath, width: 8, height: 8 }, 0, comingUp);
    args[args.length - 1] = output;
    run(args);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const duration = Number(JSON.parse(probe.stdout).format.duration);
    assert.ok(duration >= 20.9 && duration < 21.2, `Output duration ${duration}`);
    const y = comingUp.top + comingUp.cards[0]!.height - 3;
    const rgb = (time: number, x: number): number[] => {
      const frame = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', output, '-ss', String(time),
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1024 * 1024 });
      assert.equal(frame.status, 0, frame.stderr.toString());
      assert.equal(frame.stdout.length, 640 * 360 * 3, `Missing frame at ${time}s`);
      return Array.from(frame.stdout.subarray((y * 640 + x) * 3, (y * 640 + x) * 3 + 3));
    };
    const first = rgb(5, 30), fifth = rgb(5, 620);
    assert.ok(first[0]! > 200 && first[1]! < 80, `First panel ${first}`);
    assert.ok(fifth[2]! > 200 && fifth[0]! < 80, `Fifth panel ${fifth}`);
    for (const time of [1, 18.8, 20.5]) {
      const background = rgb(time, 620);
      assert.ok(background[2]! < 100 && background[0]! < 80, `Panels should uncover the programme at ${time}s: ${background}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
