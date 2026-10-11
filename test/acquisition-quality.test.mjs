import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { youtubeQualityArgs } from '../dist/src/acquisition/adapters.js';

const downloader = process.env.LKP_YT_DLP ?? path.resolve('runtime/tools/yt-dlp/bin/yt-dlp');
const video = (id, height, codec, audio = false) => ({ format_id: id, height, width: height * 16 / 9,
  vcodec: codec, acodec: audio ? 'mp4a.40.2' : 'none', ext: 'mp4', url: `https://example.invalid/${id}.mp4` });
const audio = { format_id: 'audio', vcodec: 'none', acodec: 'mp4a.40.2', ext: 'm4a', url: 'https://example.invalid/audio.m4a' };

for (const scenario of [
  { name: '1080p VP9 beats 360p H.264', formats: [video('low', 360, 'avc1.640028', true), video('hd', 1080, 'vp9'), audio], selected: 'hd+audio' },
  { name: '1080p VP9 beats 720p H.264', formats: [video('sd', 720, 'avc1.640028'), video('hd', 1080, 'vp9'), audio], selected: 'hd+audio' },
  { name: 'H.264 wins at equal resolution', formats: [video('avc', 1080, 'avc1.640028'), video('vp9', 1080, 'vp9'), audio], selected: 'avc+audio' },
  { name: '480p source is accepted', formats: [video('sd', 480, 'avc1.640028', true)], selected: 'sd' },
  { name: '360p only is rejected', formats: [video('low', 360, 'avc1.640028', true)] },
  { name: 'unknown height is rejected', formats: [video('unknown', undefined, 'avc1.640028', true)] },
  { name: '2160p is capped at available 1080p', formats: [video('uhd', 2160, 'vp9'), video('hd', 1080, 'vp9'), audio], selected: 'hd+audio' },
]) {
  test(`real yt-dlp selection: ${scenario.name}`, { skip: !fs.existsSync(downloader) && 'yt-dlp integration runs on the Pi' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-quality-'));
    try {
      const file = path.join(dir, 'fixture.json');
      fs.writeFileSync(file, JSON.stringify({ id: 'fixture', title: 'Quality fixture', extractor: 'generic', webpage_url: 'https://example.invalid/video', formats: scenario.formats }));
      const result = spawnSync(downloader, ['--ignore-config', '--no-warnings', ...youtubeQualityArgs, '--skip-download', '--load-info-json', file, '--print', '%(format_id)s'], { encoding: 'utf8', timeout: 20000 });
      if (scenario.selected) {
        assert.equal(result.status, 0, 'selector must accept this source');
        assert.equal(result.stdout.trim(), scenario.selected);
      } else assert.notEqual(result.status, 0, 'selector must reject this source');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
