import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import { assertMediaStorage } from '../src/media-storage.js';
import type { ProgrammeMetadata } from '../src/weather/model.js';

const config = loadConfig();
assertMediaStorage(config);
const db = new Database(config.storage.database, { readonly: true });
try {
  const broken = db.prepare(`WITH events AS (
    SELECT starts_at_ms, ends_at_ms, duration_ms, lag(ends_at_ms) OVER (ORDER BY starts_at_ms) previous_end
    FROM schedule_entries
  ) SELECT count(*) count FROM events WHERE (previous_end IS NOT NULL AND previous_end != starts_at_ms)
    OR duration_ms != ends_at_ms-starts_at_ms`).get() as { count: number };
  assert.equal(broken.count, 0, 'Stored timeline must remain gapless and whole');
  const weather = db.prepare(`SELECT id, media_id, starts_at_ms, ends_at_ms, duration_ms, media_path, epg_event_id
    FROM schedule_entries WHERE show_id='lkp-weather' AND starts_at_ms>=? ORDER BY starts_at_ms`).all(Date.now() - 86400000) as Array<{
    id: string; media_id: string; starts_at_ms: number; ends_at_ms: number; duration_ms: number; media_path: string; epg_event_id: number;
  }>;
  assert.ok(weather.length, 'A fresh weather episode must actually be scheduled');
  for (const row of weather) {
    assert.ok(row.media_path.startsWith(config.media.generatedRoot + path.sep), 'Weather must be on the external media drive');
    const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(row.media_path), 'programme.json'), 'utf8')) as ProgrammeMetadata;
    assert.equal(meta.preview, false);
    assert.equal(meta.id, row.media_id);
    assert.ok(row.starts_at_ms >= Date.parse(meta.validFrom));
    assert.ok(row.ends_at_ms <= Date.parse(meta.validUntil));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', row.media_path], { encoding: 'utf8' })) as {
      streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; pix_fmt?: string; r_frame_rate?: string; sample_rate?: string; channels?: number }>;
      format: { duration: string };
    };
    const video = probe.streams.find(s => s.codec_type === 'video')!;
    const audio = probe.streams.find(s => s.codec_type === 'audio')!;
    assert.deepEqual([video.codec_name, video.width, video.height, video.r_frame_rate], ['h264', 1920, 1080, '30/1']);
    // ffprobe calls full-range H.264 8-bit 4:2:0 "yuvj420p"; playout's
    // normalizer accepts both ranges and emits its configured broadcast format.
    assert.ok(video.pix_fmt === 'yuv420p' || video.pix_fmt === 'yuvj420p', 'Video must be 8-bit YUV 4:2:0');
    assert.equal(audio.codec_name, 'aac');
    assert.ok(Math.abs(Number(probe.format.duration) * 1000 - row.duration_ms) < 100);
    console.log(JSON.stringify({ edition: meta.edition, startsAt: new Date(row.starts_at_ms).toISOString(), endsAt: new Date(row.ends_at_ms).toISOString(), mediaPath: row.media_path, epgEventId: row.epg_event_id, verified: true }));
  }
  const xml = fs.readFileSync(config.epg.output, 'utf8');
  const events = [...xml.matchAll(/event_id="(\d+)" start_time="([^"]+)" duration="(\d+):(\d+):(\d+)"[\s\S]*?<event_name>([^<]*)/g)].map(m => ({
    id: Number(m[1]), start: Date.parse(m[2]!.replace(' ', 'T') + 'Z'),
    duration: (Number(m[3]) * 3600 + Number(m[4]) * 60 + Number(m[5])) * 1000, name: m[6],
  }));
  assert.ok(events.length);
  assert.equal(new Set(events.map(e => e.id)).size, events.length, 'EPG IDs must be unique');
  for (let i = 1; i < events.length; i++) assert.equal(events[i]!.start, events[i - 1]!.start + events[i - 1]!.duration, 'DVB guide must have no gaps or overlaps');
  assert.ok(events.every(e => e.name && e.duration > 0));
  for (const row of weather) assert.ok(events.some(e => e.id === row.epg_event_id && e.start === Math.floor(row.starts_at_ms / 1000) * 1000), 'Published weather must appear in the shared guide');
  console.log(JSON.stringify({ epgEvents: events.length, storedTimeline: 'gapless', guide: 'gapless', verified: true }));
} finally {
  db.close();
}
