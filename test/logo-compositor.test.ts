import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareLogo } from '../src/logo.js';
import { buildFfmpegArgs } from '../src/playout.js';
import { buildScheduleEntries } from '../src/schedule.js';
import { config, item } from './helpers.js';

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('completed logo rotations hold a clean frame without leftover edge pixels',
  { skip: !ffmpegAvailable, timeout: 30_000 }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-logo-compositor-'));
    try {
      const c = config(root);
      c.video.width = 320;
      c.video.height = 240;
      c.logo = { ...c.logo, path: path.resolve('assets/logo/lkp-logo.svg'), width: 120, left: 64, top: 64 };
      const logo = prepareLogo(c);
      const media = item('a', 1);
      const entry = buildScheduleEntries([media], 'seed', 0, 10_000)[0]!;
      const frameBytes = c.video.width * c.video.height * 3 / 2;
      const render = (animate: boolean): Buffer => {
        const args = buildFfmpegArgs(entry, media, 0, 3000, animate, c, logo);
        const filter = args[args.indexOf('-filter_complex') + 1]!;
        // Exercise the production compositor with synthetic programme pixels,
        // without invoking playout, a schedule database or an output service.
        const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error',
          '-filter_complex_threads', '1', '-f', 'lavfi', '-i', 'color=c=0x336699:s=320x240:r=30:d=3',
          '-framerate', '30', '-i', logo.path, '-filter_complex', filter, '-map', '[v]',
          '-an', '-c:v', 'rawvideo', '-threads', '1', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', 'pipe:1'],
        { maxBuffer: 16 * 1024 * 1024, timeout: 15_000 });
        assert.equal(result.status, 0, result.error?.message ?? result.stderr.toString());
        assert.equal(result.stdout.length, frameBytes * 90);
        return result.stdout;
      };
      const cold = render(false).subarray(0, frameBytes);
      // Cover both a frame-aligned endpoint and a duration between frames.
      for (const durationMs of [1100, 1117]) {
        c.logo.transitionDurationMs = durationMs;
        const animation = render(true);
        const first = animation.subarray(0, frameBytes);
        assert.equal(animation.subarray(frameBytes * 15, frameBytes * 16).equals(first), false,
          'the rotation still animates');
        for (const frame of [Math.ceil(durationMs * 30 / 1000), 60, 89]) {
          assert.ok(animation.subarray(frame * frameBytes, (frame + 1) * frameBytes).equals(first),
            `frame ${frame} must restore and hold the original clean logo`);
        }
        // Padding must also preserve the static logo's position. Chroma sampling
        // at its odd-height boundary may differ; compare the luma plane exactly.
        assert.ok(first.subarray(0, 320 * 240).equals(cold.subarray(0, 320 * 240)),
          'the resting logo must keep its cold-start position and luma');
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
