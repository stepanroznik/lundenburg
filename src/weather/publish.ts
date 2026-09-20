import fs from 'node:fs';
import path from 'node:path';
import { LkpDatabase } from '../database.js';
import type { AppConfig, ScheduleEntry } from '../types.js';
import { stableId } from '../util.js';
import type { ProgrammeMetadata } from './model.js';

// Insertion is explicit and transactional. Existing programmes are kept whole;
// only future boundaries move. Ordinary append-only schedule generation is unchanged.
export function publishWeather(meta: ProgrammeMetadata, db: LkpDatabase, config: AppConfig, atMs: number): ScheduleEntry {
  if (meta.preview) throw new Error('Mock/silent/partial previews cannot be published');
  if (!fs.existsSync(meta.mediaPath) || !fs.existsSync(meta.subtitlePath)) throw new Error('Finished weather media/subtitles are missing');
  const from = Date.parse(meta.validFrom), until = Date.parse(meta.validUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until) || !Number.isFinite(meta.durationMs) || meta.durationMs <= 0) throw new Error('Invalid generated programme metadata');
  const existing = db.db.prepare('SELECT id FROM schedule_entries WHERE media_id=?').get(meta.id);
  if (existing) throw new Error(`Edition already scheduled: ${meta.id}`);
  const boundary = db.nextAfter(Math.max(atMs, from));
  if (!boundary || boundary.startsAtMs <= Date.now() + 30_000 || boundary.startsAtMs + meta.durationMs > until) throw new Error('No safe future programme boundary within the forecast validity window');
  const entry: ScheduleEntry = { id: stableId(meta.id, boundary.startsAtMs), sequence: boundary.sequence, mediaId: meta.id, showId: 'lkp-weather', showTitle: 'LKP Wetterfreunde', episodeTitle: meta.title, description: 'Das Wetter in Lundenburg, Wien, Brno und Bratislava.', startsAtMs: boundary.startsAtMs, endsAtMs: boundary.startsAtMs + meta.durationMs, durationMs: meta.durationMs, mediaPath: path.resolve(meta.mediaPath), audioLanguage: 'mul', subtitleLanguages: ['de', 'cs', 'sk'] };
  db.db.transaction(() => {
    // Check again under the write transaction to avoid publishing against a moved boundary.
    const current = db.nextAfter(Math.max(atMs, from));
    if (!current || current.id !== boundary.id || current.startsAtMs !== boundary.startsAtMs) throw new Error('Schedule changed during publication; regenerate against its new boundary');
    const future = db.db.prepare('SELECT id, media_id, media_path FROM schedule_entries WHERE sequence>=? ORDER BY sequence DESC').all(boundary.sequence) as Array<{ id: string; media_id: string; media_path: string }>;
    for (const row of future) {
      if (row.media_id.startsWith('weather-')) {
        const file = path.join(path.dirname(row.media_path), 'programme.json');
        if (!fs.existsSync(file)) throw new Error('Cannot shift weather without its validity metadata');
        const other = JSON.parse(fs.readFileSync(file, 'utf8')) as ProgrammeMetadata;
        const scheduled = db.db.prepare('SELECT ends_at_ms FROM schedule_entries WHERE id=?').get(row.id) as { ends_at_ms: number };
        if (scheduled.ends_at_ms + meta.durationMs > Date.parse(other.validUntil)) throw new Error('Insertion would push another weather edition beyond its validity');
      }
      db.db.prepare('UPDATE schedule_entries SET sequence=sequence+1, starts_at_ms=starts_at_ms+?, ends_at_ms=ends_at_ms+? WHERE id=?').run(meta.durationMs, meta.durationMs, row.id);
    }
    db.insertSchedule([entry]);
  }).immediate();
  // Generated programmes remain outside the weighted, endlessly repeating catalogue.
  fs.writeFileSync(path.join(path.dirname(meta.mediaPath), 'scheduled.json'), JSON.stringify({ entry, database: config.storage.database }, null, 2));
  return entry;
}
