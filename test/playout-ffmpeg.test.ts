import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { prepareLogo } from '../src/logo.js';
import { buildFfmpegArgs } from '../src/playout.js';
import { buildScheduleEntries } from '../src/schedule.js';
import { config, item } from './helpers.js';

const available = spawnSync('ffmpeg', ['-version']).status === 0;
function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout;
}

test('real FFmpeg retains 1080p30 after finite live animation and reuses the raster cache', { skip: !available }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-graphics-'));
  try {
    const c = config(root);
    c.logo.path = path.resolve('assets/logo/lkp-logo.svg');
    c.logo.width = 120; c.logo.left = 96; c.logo.top = 54;
    c.video.preset = 'ultrafast';
    const logo = prepareLogo(c);
    assert.equal(logo.width, 120);
    assert.equal(logo.height, 128);
    const modified = fs.statSync(logo.path).mtimeMs;
    assert.deepEqual(prepareLogo(c), logo);
    assert.equal(fs.statSync(logo.path).mtimeMs, modified);
    c.logo.opacity = 0.5;
    assert.notEqual(prepareLogo(c).path, logo.path);
    const media = item('test', 1, 3000);
    media.mediaPath = path.join(root, 'source.mp4');
    run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x304050:s=1920x1080:r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-c:a', 'aac', media.mediaPath]);
    const entry = buildScheduleEntries([media], 'seed', 0, 3000)[0]!;
    for (const animate of [false, true]) {
      const output = path.join(root, `${animate}.ts`);
      const args = buildFfmpegArgs(entry, media, 0, 3000, animate, c, logo);
      args[args.length - 1] = output;
      run('ffmpeg', args);
      const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
        '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames', '-of', 'json', output]));
      assert.equal(probe.streams[0].width, 1920);
      assert.equal(probe.streams[0].height, 1080);
      assert.equal(probe.streams[0].r_frame_rate, '30/1');
      assert.equal(Number(probe.streams[0].nb_read_frames), 90);
      // Compare the filtered pixels directly, independent of lossy H.264 encoding.
      const rawArgs = args.slice(0, args.indexOf('-map'));
      rawArgs.push('-map', '[v]');
      const graphIndex = rawArgs.indexOf('-filter_complex') + 1;
      rawArgs[graphIndex] = rawArgs[graphIndex]!.replace('[v]', '[composite];[composite]select=eq(n\\,60)[v]');
      const frame = path.join(root, `${animate}.rgb`);
      rawArgs.push('-frames:v', '1', '-threads', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', frame);
      run('ffmpeg', rawArgs);
    }
    const staticFrame = fs.readFileSync(path.join(root, 'false.rgb'));
    const animatedFrame = fs.readFileSync(path.join(root, 'true.rgb'));
    assert.ok(animatedFrame.equals(staticFrame), 'settled animation must match static size, alpha and position exactly');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
