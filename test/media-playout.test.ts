import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEpisodeFilename } from '../src/media.js';
import { buildFfmpegArgs, internetFfmpegArgs, scheduleTimeForBroadcast, shiftScheduleForBroadcast } from '../src/playout.js';
import { buildScheduleEntries } from '../src/schedule.js';
import { config, item } from './helpers.js';

test('conventional episode filenames are parsed without duplicating metadata', () => {
  assert.deepEqual(parseEpisodeFilename('S01E03 - Tělesná stráž.mp4'), { season: 1, episode: 3, title: 'Tělesná stráž' });
});

test('cold start can use static logo while real transition uses three rotations', () => {
  const c = config('/tmp/lkp-test');
  const media = item('a', 1);
  const entry = buildScheduleEntries([media], 'seed', 0, 10_000)[0]!;
  const cold = buildFfmpegArgs(entry, media, 5_000, 5_000, false, c, { path: '/tmp/logo.png', width: 220, height: 234 }).join(' ');
  const transition = buildFfmpegArgs(entry, media, 0, 10_000, true, c, { path: '/tmp/logo.png', width: 220, height: 234 }).join(' ');
  assert.ok(!cold.includes('rotate='));
  assert.ok(!cold.includes('-loop'));
  assert.match(cold, /eof_action=repeat:repeatlast=1/);
  assert.match(transition, /loop=loop=33:size=1/);
  assert.match(transition, /-filter_complex_threads 1/);
  assert.match(transition, /2\*PI\*3/);
  assert.match(transition, /1\+0\.08000000000000007/);
  assert.match(transition, /-threads 2/);
  assert.ok(!transition.includes('-c:s dvbsub'));
});

test('past broadcast offset shifts lookup time and EPG times without changing the stored entry', () => {
  const media = item('a', 1);
  const entry = buildScheduleEntries([media], 'seed', 1_000_000, 2_000_000)[0]!;
  const offset = 90 * 60_000;
  const shifted = shiftScheduleForBroadcast([entry], offset)[0]!;

  assert.equal(scheduleTimeForBroadcast(10_000_000, offset), 4_600_000);
  assert.equal(shifted.startsAtMs, entry.startsAtMs + offset);
  assert.equal(shifted.endsAtMs, entry.endsAtMs + offset);
  assert.equal(entry.startsAtMs, 1_000_000);
});

test('Internet HLS reuses encoded video and converts only audio for browsers', () => {
  const args = internetFfmpegArgs(config('/tmp/lkp-test')).join(' ');
  assert.match(args, /-c:v copy/);
  assert.match(args, /-c:a aac/);
  assert.match(args, /-hls_time 2/);
  assert.match(args, /delete_segments/);
});
