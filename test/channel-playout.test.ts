import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { LkpDatabase } from '../src/database.js';
import { loadStationConfig, profileConfig } from '../src/channels.js';
import { runBroadcast } from '../src/playout.js';
import { prepareLogo } from '../src/logo.js';
import { config, item } from './helpers.js';
import type { ScheduleEntry } from '../src/types.js';

test('dusk handover keeps one output, aligned wall-clock events and continuous TS counters', { timeout: 35000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ln-live-handover-')), app = config(root);
  app.video = { ...app.video, width: 640, height: 360, cpuAffinity: '', preset: 'ultrafast', bitrate: '600k', muxRate: 1000000 };
  app.logo = { ...app.logo, path: path.resolve('assets/logo/lkp-logo.svg'), width: 60, left: 12, top: 12 };
  app.schedule.horizonDays = 1;
  app.station = loadStationConfig(path.resolve('.'))!; app.station.enabled = true;
  const source = path.join(root, 'source.mp4'), ident = path.join(root, 'ident.mp4'), broken = path.join(root, 'broken.mp4');
  for (const [file, color, duration] of [[source, 'blue', '3'], [ident, 'gold', '1']]) {
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=30:d=${duration}`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', duration!, '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-c:a', 'aac', file!], { stdio: 'pipe' });
  }
  fs.writeFileSync(broken, 'not a playable media file');
  app.station.assetManifest = path.join(root, 'assets.json');
  fs.writeFileSync(app.station.assetManifest, JSON.stringify({ version: 1, status: 'ready', fps: 30,
    assets: ['evening', 'morning', 'ident', 'outro', 'continuity', 'day-continuity'].map(id => ({ id, path: ident, durationMs: 1000, fullScreen: true, destination: 'ln' })) }));
  const db = new LkpDatabase(app.storage.database);
  try {
    const kids = { ...item('fixture-kids', 1, 3000), mediaPath: source };
    const adult = { ...item('fixture-adult', 1, 3000), mediaPath: path.join(root, 'adult.mp4'), broadcast: {
      profiles: ['ln' as const], recommendedAge: 16 as const, ratingSource: 'editorial' as const, category: 'science', topics: [], intensity: 'moderate' as const,
      timeOfNight: 'any' as const, retention: 'standard' as const, priority: 50 } };
    const brokenAdult = { ...item('fixture-broken', 1, 3000), mediaPath: broken, broadcast: adult.broadcast };
    fs.copyFileSync(source, adult.mediaPath); db.upsertMedia([kids, adult, brokenAdult]);
    // Rasterizing an uncached SVG on the Pi can outlast these short slots.
    // Complete setup before starting the handover fixture's wall clock.
    prepareLogo(app);
    prepareLogo(profileConfig(app, 'ln'));
    const realStart = Date.now() + 500;
    const switchAt = DateTime.fromISO('2026-10-16T20:00:00', { zone: 'Europe/Prague' }).toMillis();
    const start = switchAt - 3000, pastOffsetMs = realStart - start;
    const make = (id: string, sequence: number, begin: number, durationMs: number, mediaId: string, mediaPath: string, profile: 'lkp' | 'ln', kind: 'programme' | 'handover' | 'gap'): ScheduleEntry => ({
      id, sequence, mediaId, showId: kind === 'programme' ? profile === 'lkp' ? kids.showId : adult.showId : `station-${profile}`,
      showTitle: 'Fixture', episodeTitle: id, description: 'Synthetic integration fixture', startsAtMs: begin, endsAtMs: begin + durationMs, durationMs,
      mediaPath, subtitleLanguages: [], presentation: { profile, kind, ...(kind === 'gap' ? { loop: true } : {}) } });
    db.insertSchedule([
      make('kids', 0, start, 3000, kids.id, source, 'lkp', 'programme'),
      make('dusk', 1, switchAt, 1000, 'station-evening', ident, 'ln', 'handover'),
      make('night', 2, switchAt + 1000, 3000, adult.id, adult.mediaPath, 'ln', 'programme'),
      make('broken', 3, switchAt + 4000, 3000, brokenAdult.id, broken, 'ln', 'programme'),
      // Cover the real startup horizon too, so later test dates do not trigger
      // thousands of unrelated three-second schedule entries before playout.
      make('tail', 4, switchAt + 7000, Math.max(10 * 86400_000, Date.now() + 3 * 86400_000 - switchAt - 7000),
        'station-continuity', ident, 'ln', 'gap'),
    ]);
    const output = path.join(root, 'channel.ts');
    await runBroadcast(db, app, { dryRun: true, once: false, rfAcknowledged: false, verbose: false, output, maxSeconds: 8.5, pastOffsetMs });
    const attempts = db.listPlayback(start, switchAt + 7000);
    assert.deepEqual(attempts.slice(0, 3).map(e => e.scheduleEntryId), ['kids', 'dusk', 'night']);
    for (const id of ['kids', 'dusk', 'night']) assert.equal(attempts.filter(e => e.scheduleEntryId === id).length, 1,
      `${id} must not be reopened for a sub-frame remainder after EOF`);
    const brokenAttempts = attempts.filter(e => e.scheduleEntryId === 'broken');
    assert.equal(brokenAttempts.length, 1, 'a damaged file should not be retried within its committed slot');
    assert.equal(brokenAttempts[0]!.status, 'failed', 'a damaged file is replaced with station continuity');
    assert.ok(Math.abs(attempts[1]!.actualStartMs - pastOffsetMs - switchAt) < 250);
    assert.ok(Math.abs(attempts[2]!.actualStartMs - pastOffsetMs - switchAt - 1000) < 250);
    const stream = fs.readFileSync(output), counters = new Map<number, number>();
    assert.ok(stream.length > 200000); assert.equal(stream.length % 188, 0);
    for (let at = 0; at < stream.length; at += 188) {
      assert.equal(stream[at], 0x47);
      const pid = ((stream[at + 1]! & 31) << 8) | stream[at + 2]!, header = stream[at + 3]!;
      if (pid === 0x1fff) continue;
      const previous = counters.get(pid);
      if (previous !== undefined) assert.equal(header & 15, (previous + (header & 16 ? 1 : 0)) & 15);
      counters.set(pid, header & 15);
    }
    const data = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_packets', '-show_entries', 'packet=pts_time', '-of', 'json', output], { encoding: 'utf8' }));
    const timestamps = data.packets.map((p: { pts_time: string }) => Number(p.pts_time));
    assert.ok(timestamps.length > 170);
    for (let i = 1; i < timestamps.length; i++) assert.ok(timestamps[i]! > timestamps[i - 1]!, 'video timestamps must advance through the identity switch');
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
