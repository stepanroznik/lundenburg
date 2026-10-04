import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { config, item } from './helpers.js';
import { textSubtitleTracks, prepareSubtitle, preparedSubtitleTracks } from '../src/subtitles.js';
import { buildFfmpegArgs } from '../src/playout.js';
import { buildScheduleEntries } from '../src/schedule.js';

test('text selection prefers a sidecar, skips failed sync, and preserves native DVB', () => {
  const media = item('a', 1, 7000), entry = buildScheduleEntries([media], 's', 0, 7000)[0]!;
  media.subtitles = [
    { language: 'cs', kind: 'embedded', codec: 'subrip', streamIndex: 2 },
    { language: 'cs', kind: 'sidecar', codec: 'srt', path: '/captions.cs.srt' },
    { language: 'de', kind: 'embedded', codec: 'subrip', streamIndex: 3, syncStatus: 'failed' },
    { language: 'en', kind: 'dvb-bitmap', codec: 'dvb_subtitle', streamIndex: 4 },
    { language: 'en', kind: 'sidecar', codec: 'srt', path: '/captions.en.srt' },
  ];
  assert.deepEqual(textSubtitleTracks(entry, media).map(t => [t.language, t.path]), [['cs', '/captions.cs.srt']]);
});

const renderer = path.resolve('runtime/tools/dvb-subtitles/render');
test('actual DVB captions survive muxing, seeking and unchanged source video', { skip: !fs.existsSync(renderer), timeout: 120000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-dvb-subtitles-'));
  try {
    const c = config(root);
    c.media.root = root;
    c.storage.runtimeDirectory = path.resolve('runtime');
    c.media.generatedRoot = path.join(root, 'generated');
    const source = path.join(root, 'source.mp4'), logo = path.join(root, 'logo.png');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=7', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '7', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-c:a', 'aac', source]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=16x16', '-frames:v', '1', '-threads', '1', logo]);
    const media = { ...item('a', 1, 7000), mediaPath: source, subtitles: [{ language: 'cs', kind: 'sidecar' as const, codec: 'srt', path: path.resolve('test/fixtures/dvb-subtitles.srt') }] };
    const entry = buildScheduleEntries([media], 's', 0, 7000)[0]!;
    const before = fs.statSync(source).mtimeMs;
    await prepareSubtitle(entry, media.subtitles[0]!, c, 7000);
    assert.equal(preparedSubtitleTracks(entry, media, c).length, 1);
    // Editorial/ad plans change event duration, not the source-caption cache.
    assert.equal(preparedSubtitleTracks({ ...entry, durationMs: 5000 }, media, c).length, 1);
    for (const seek of [0, 2000]) {
      const args = buildFfmpegArgs(entry, media, seek, 7000 - seek, false, c, { path: logo, width: 16, height: 16 });
      const output = path.join(root, `playout-${seek}.ts`);
      args[args.length - 1] = output;
      assert.match(args.join(' '), /-c:s copy/);
      assert.match(args.join(' '), /language=ces/);
      execFileSync('ffmpeg', args, { timeout: 45000, stdio: ['ignore', 'ignore', 'pipe'] });
      const decoded = JSON.parse(execFileSync(renderer, ['--verify', output], { encoding: 'utf8' })) as { nonempty: number; clear: number; maxDepth: number; whitePixels: number; blackPixels: number };
      assert.ok(decoded.nonempty >= 2, 'Cold starts must retain the caption already active at the seek point');
      assert.ok(decoded.clear > 0);
      assert.equal(decoded.maxDepth, 4, 'Broadcast regions must use TV-compatible 4-bit encoding');
      assert.ok(decoded.whitePixels > 100, 'Decoded captions must contain white glyphs, not just black outlines');
      assert.ok(decoded.blackPixels > 100, 'Decoded captions must retain black outlines');
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_data', '-of', 'json', output], { encoding: 'utf8' })) as { streams: Array<{ codec_name: string; extradata?: string; tags?: { language?: string } }> };
      const subtitles = probe.streams.find(s => s.codec_name === 'dvb_subtitle' && s.tags?.language === 'ces');
      assert.ok(subtitles);
      assert.match(subtitles.extradata ?? '', /0001 0001 14/, 'HD display sets must advertise DVB HD type 0x14, not legacy type 0x10');
    }
    assert.equal(fs.statSync(source).mtimeMs, before);
    const wide = path.join(root, 'wide.mkv');
    execFileSync(renderer, [path.resolve('test/fixtures/dvb-subtitles-wide.ass'), wide, '1920', '1080', '4000', 'deu']);
    const wideDecoded = JSON.parse(execFileSync(renderer, ['--verify', wide], { encoding: 'utf8' })) as { nonempty: number; whitePixels: number; maxDepth: number };
    assert.ok(wideDecoded.nonempty > 0 && wideDecoded.whitePixels > 100);
    assert.equal(wideDecoded.maxDepth, 4, 'Distant positioned ASS captions must fit DVB object/pixel limits');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
