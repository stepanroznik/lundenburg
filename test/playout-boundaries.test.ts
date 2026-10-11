import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { LkpDatabase } from '../src/database.js';
import { runBroadcast } from '../src/playout.js';
import { readPlayoutStatus, timingLabel, writePlayoutStatus } from '../src/playout-status.js';
import { recoveryIntermission } from '../src/continuity.js';
import type { RotationClip } from '../src/intermissions/rotation.js';
import { config, item } from './helpers.js';

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const clip = (id: string, durationMs: number, season?: RotationClip['season']): RotationClip => ({
  id, durationMs, title: id, kind: 'silent', mediaPath: `/tmp/${id}.mp4`, languages: [], synopsis: '', ...(season ? { season } : {}),
});

test('recovery uses a whole seasonal intermission which fits, otherwise carries the difference', () => {
  const at = Date.UTC(2026, 8, 29);
  const clips = [clip('short', 5000), clip('best', 17000), clip('partial', 12000), clip('too-long', 18000), clip('wrong-season', 16900, 'winter')];
  assert.equal(recoveryIntermission(clips, 5000, 12000, at)?.id, 'best');
  assert.equal(recoveryIntermission(clips.filter((c) => c.id !== 'best'), 5000, 12000, at)?.id, 'partial');
  assert.equal(recoveryIntermission(clips, 5000, 3000, at), undefined);
  assert.equal(recoveryIntermission(clips, 5000, 100, at), undefined);
  assert.equal(recoveryIntermission(clips, 17000, -12000, at)?.id, 'short');
  assert.equal(recoveryIntermission([], 5000, 12000, at), undefined);
});

test('a twelve-second shortfall starts the next piece immediately and recovers with a longer whole intermission',
  { skip: !ffmpegAvailable, timeout: 90_000 }, async (t) => {
    // WSL host clock corrections can jump Date.now while monotonic time keeps
    // advancing normally. Exercise the same strict timing checks on a stable
    // wall-clock projection so the fixture measures encoder/pacer continuity.
    const wallStart = Date.now(), monotonicStart = performance.now();
    t.mock.method(Date, 'now', () => Math.floor(wallStart + performance.now() - monotonicStart));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-boundaries-'));
    const c = config(root);
    c.video = { ...c.video, width: 1920, height: 1080, cpuAffinity: '0,1', preset: 'ultrafast', bitrate: '3800k', muxRate: 4976471 };
    c.logo = { ...c.logo, path: path.resolve('assets/logo/lkp-logo.svg'), width: 120, left: 96, top: 54 };
    c.schedule.horizonDays = 1;
    // Three seconds lets the cold encoder catch up before its first handoff;
    // all later pieces are acquired from the prepared queue.
    const firstPath = path.join(root, 'first.mp4');
    const shortPath = path.join(root, 'short.mp4');
    const longPath = path.join(root, 'long.mp4');
    const middlePath = path.join(root, 'middle.mp4');
    for (const [file, duration] of [[firstPath, '3'], [shortPath, '1.2'], [longPath, '13.2'], [middlePath, '2.4']]) {
      const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-t', duration!, '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-c:a', 'aac', file!], { encoding: 'utf8' });
      assert.equal(generated.status, 0, generated.stderr);
    }
    const manifest = path.join(root, 'published.json');
    fs.writeFileSync(manifest, JSON.stringify({ version: 1, revision: 'test', clips: [
      { ...clip('short', 1200), mediaPath: shortPath }, { ...clip('long', 13200), mediaPath: longPath },
    ] }));
    c.intermissions = { enabled: true, manifest, boundaryRate: 0, weights: { ident: 70, silent: 20, voiced: 10 } };
    const db = new LkpDatabase(c.storage.database);
    const originalPath = process.env.PATH;
    let monitor: NodeJS.Timeout | undefined;
    try {
      const media = { ...item('a', 1, 15000), mediaPath: firstPath };
      db.replaceMedia([media]);
      const start = Date.now() + 400;
      const first = {
        id: 'short-programme', sequence: 0, mediaId: media.id, showId: media.showId,
        showTitle: media.showTitle, episodeTitle: media.episodeTitle, description: '',
        startsAtMs: start, endsAtMs: start + 15000, durationMs: 15000, mediaPath: firstPath, subtitleLanguages: [],
      };
      const makeNext = (previous: typeof first, id: string, durationMs: number, intermission = false) => ({
        ...first, id, sequence: previous.sequence + 1, startsAtMs: previous.endsAtMs,
        endsAtMs: previous.endsAtMs + durationMs, durationMs,
        ...(intermission ? { showId: 'lkp-intermissions', listingVisibility: 'hidden' as const, mediaPath: shortPath } : {}),
      });
      const firstIdent = makeNext(first, 'already-prepared-short-ident', 1200, true);
      const programme = { ...makeNext(firstIdent, 'next-programme', 2400), mediaPath: middlePath,
        playoutPlan: { version: 1 as const, programmeEventId: 'next-programme', sourceDurationMs: 2400,
          durationMs: 2400, warnings: [], segments: [
            { type: 'content' as const, mediaPath: middlePath, fromMs: 0, toMs: 1200, durationMs: 1200 },
            { type: 'credits' as const, mediaPath: middlePath, fromMs: 1200, toMs: 2400, durationMs: 1200 },
          ] } };

      const recovery = makeNext(programme, 'recovery-ident', 1200, true);
      // Leave another source available even if recovery regresses, so the
      // assertions report timing failure instead of schedule exhaustion.
      const filler = { ...makeNext(recovery, 'following-programme', 2 * 86_400_000), mediaPath: longPath };
      const tail = { ...makeNext(filler, 'tail-programme', 2 * 86_400_000), mediaPath: longPath };
      const schedule = [first, firstIdent, programme, recovery, filler, tail];
      db.insertSchedule(schedule);
      const storedSchedule = db.listSchedule(start, filler.endsAtMs);
      const output = path.join(root, 'channel.ts');
      const realFfmpeg = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' }).stdout.trim();
      const wrapper = path.join(root, 'bin'); fs.mkdirSync(wrapper);
      fs.writeFileSync(path.join(wrapper, 'ffmpeg'), `#!/bin/sh
for arg do
  case "$arg" in */first.mp4|*/short.mp4|*/long.mp4|*/middle.mp4) sleep 0.4; break;; esac
done
exec '${realFfmpeg.replaceAll("'", "'\\''")}' "$@"
`, { mode: 0o755 });
      process.env.PATH = `${wrapper}:${originalPath}`;
      const arrivals: number[] = []; let previousSize = 0;
      const statusSamples: NonNullable<ReturnType<typeof readPlayoutStatus>>[] = [];
      monitor = setInterval(() => {
        if (!fs.existsSync(output)) return;
        const status = readPlayoutStatus(path.join(c.storage.runtimeDirectory, 'playout-preview-status.json'));
        if (status) statusSamples.push(status);
        const size = fs.statSync(output).size;
        if (size > previousSize) { arrivals.push(Date.now()); previousSize = size; }
      }, 10);
      await runBroadcast(db, c, { dryRun: true, once: false, rfAcknowledged: false, verbose: false, output, maxSeconds: 21 });
      const attempts = db.listPlayback(start, tail.endsAtMs);
      assert.deepEqual(attempts.map((attempt) => attempt.scheduleEntryId), schedule.slice(0, 5).map((entry) => entry.id));
      assert.deepEqual(attempts.map((attempt) => attempt.status), ['completed', 'completed', 'completed', 'completed', 'interrupted']);
      assert.ok(attempts[1]!.actualStartMs < first.endsAtMs - 11500, 'the next piece must start about twelve seconds early, without a held frame');
      assert.ok(attempts[3]!.actualEndMs! - attempts[3]!.actualStartMs > 13000, 'recovery must play the longer intermission in full');
      assert.ok(Math.abs(attempts[4]!.actualStartMs - filler.startsAtMs) < 250, 'the next programme must return to the planned clock');
      assert.deepEqual(db.listSchedule(start, filler.endsAtMs), storedSchedule, 'runtime recovery must not rewrite the stored schedule');
      const transport = fs.readFileSync(output);
      assert.equal(transport.length % 188, 0);
      const continuity = new Map<number, number>();
      for (let offset = 0; offset < transport.length; offset += 188) {
        assert.equal(transport[offset], 0x47);
        const pid = ((transport[offset + 1]! & 0x1f) << 8) | transport[offset + 2]!;
        if (pid === 0x1fff) continue;
        const header = transport[offset + 3]!; const previous = continuity.get(pid);
        if (previous !== undefined) assert.equal(header & 0x0f, (previous + ((header & 0x10) ? 1 : 0)) & 0x0f);
        continuity.set(pid, header & 0x0f);
      }
      const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
        '-show_packets', '-show_entries', 'packet=pts_time', '-of', 'json', output], { encoding: 'utf8' });
      assert.equal(probe.status, 0, probe.stderr);
      const times = (JSON.parse(probe.stdout) as { packets: Array<{ pts_time: string }> }).packets.map((packet) => Number(packet.pts_time));
      assert.ok(times.length > 550);
      assert.ok(statusSamples.some((status) => status.state === 'running' && status.leadMs > 11500 && status.direction === 'ahead'));
      assert.ok(statusSamples.some((status) => status.current?.scheduleEntryId === filler.id && Math.abs(status.leadMs) < 250));
      assert.ok(statusSamples.some((status) => status.next?.ready));
      for (let index = 1; index < times.length; index += 1) {
        const delta = times[index]! - times[index - 1]!;
        assert.ok(delta > 0 && delta < 0.15, `video timestamp gap or replay: ${delta}s at frame ${index}`);
      }
      const changes = arrivals.filter((at) => at > start + 1500 && at < start + 20000);
      for (let index = 1; index < changes.length; index += 1) {
        const gap = changes[index]! - changes[index - 1]!;
        assert.ok(gap < 250, `transport paused for ${gap}ms despite preloading`);
      }
    } finally {
      clearInterval(monitor);
      if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
      db.close(); fs.rmSync(root, { recursive: true, force: true });
    }
  });

test('live status reports signed timing and marks crashed-process snapshots stale', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-status-'));
  const file = path.join(root, 'status.json');
  try {
    writePlayoutStatus(file, { version: 1, state: 'running', pid: process.pid, updatedAtMs: 1000,
      leadMs: 12000, driftMs: -12000, direction: 'ahead', current: null, next: null });
    assert.equal(readPlayoutStatus(file, 2000)?.stale, false);
    assert.equal(readPlayoutStatus(file, 7000)?.stale, true);
    assert.equal(timingLabel({ leadMs: 12000 }), '12.0 s ahead of schedule');
    assert.equal(timingLabel({ leadMs: -3000 }), '3.0 s behind schedule');
    assert.equal(timingLabel({ leadMs: 100 }), 'On schedule');
    fs.writeFileSync(file, 'partial invalid snapshot');
    assert.equal(readPlayoutStatus(file), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
