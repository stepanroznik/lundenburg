import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { MediaItem, PlaybackEvent, ScheduleEntry } from './types.js';

type Db = InstanceType<typeof Database>;

export class LkpDatabase {
  readonly db: Db;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void { this.db.close(); }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        show_id TEXT NOT NULL,
        show_title TEXT NOT NULL,
        show_description TEXT NOT NULL,
        default_language TEXT,
        weight REAL NOT NULL,
        season INTEGER,
        episode INTEGER,
        episode_title TEXT NOT NULL,
        description TEXT NOT NULL,
        media_path TEXT NOT NULL UNIQUE,
        duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
        audio_language TEXT,
        subtitles_json TEXT NOT NULL,
        technical_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        scanned_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schedule_entries (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        media_id TEXT NOT NULL,
        show_id TEXT NOT NULL,
        show_title TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        episode_title TEXT NOT NULL,
        description TEXT NOT NULL,
        starts_at_ms INTEGER NOT NULL,
        ends_at_ms INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        media_path TEXT NOT NULL,
        audio_language TEXT,
        subtitle_languages_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        CHECK(ends_at_ms > starts_at_ms)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS schedule_time_unique ON schedule_entries(starts_at_ms, ends_at_ms);
      CREATE INDEX IF NOT EXISTS schedule_lookup ON schedule_entries(starts_at_ms, ends_at_ms);
      CREATE TABLE IF NOT EXISTS playback_log (
        id TEXT PRIMARY KEY,
        schedule_entry_id TEXT NOT NULL,
        planned_start_ms INTEGER NOT NULL,
        planned_end_ms INTEGER NOT NULL,
        actual_start_ms INTEGER NOT NULL,
        actual_end_ms INTEGER,
        initial_seek_ms INTEGER NOT NULL,
        cold_start_resume INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS playback_schedule ON playback_log(schedule_entry_id);
    `);
  }

  replaceMedia(items: MediaItem[]): void {
    const upsert = this.db.prepare(`
      INSERT INTO media_items (
        id, show_id, show_title, show_description, default_language, weight, season, episode,
        episode_title, description, media_path, duration_ms, audio_language, subtitles_json,
        technical_json, enabled, scanned_at_ms
      ) VALUES (
        @id, @showId, @showTitle, @showDescription, @defaultLanguage, @weight, @season, @episode,
        @episodeTitle, @description, @mediaPath, @durationMs, @audioLanguage, @subtitlesJson,
        @technicalJson, @enabled, @scannedAtMs
      ) ON CONFLICT(id) DO UPDATE SET
        show_id=excluded.show_id, show_title=excluded.show_title, show_description=excluded.show_description,
        default_language=excluded.default_language, weight=excluded.weight, season=excluded.season,
        episode=excluded.episode, episode_title=excluded.episode_title, description=excluded.description,
        media_path=excluded.media_path, duration_ms=excluded.duration_ms, audio_language=excluded.audio_language,
        subtitles_json=excluded.subtitles_json, technical_json=excluded.technical_json,
        enabled=excluded.enabled, scanned_at_ms=excluded.scanned_at_ms
    `);
    const transaction = this.db.transaction((rows: MediaItem[]) => {
      const scannedAtMs = Date.now();
      const ids = new Set(rows.map((row) => row.id));
      for (const row of rows) upsert.run({
        ...row,
        defaultLanguage: row.defaultLanguage ?? null,
        season: row.season ?? null,
        episode: row.episode ?? null,
        audioLanguage: row.audioLanguage ?? null,
        subtitlesJson: JSON.stringify(row.subtitles),
        technicalJson: JSON.stringify(row.technical),
        enabled: row.enabled ? 1 : 0,
        scannedAtMs,
      });
      for (const existing of this.db.prepare('SELECT id FROM media_items').all() as Array<{ id: string }>) {
        if (!ids.has(existing.id)) this.db.prepare('UPDATE media_items SET enabled=0 WHERE id=?').run(existing.id);
      }
    });
    transaction(items);
  }

  listMedia(enabledOnly = true): MediaItem[] {
    const rows = this.db.prepare(`SELECT * FROM media_items ${enabledOnly ? 'WHERE enabled=1' : ''} ORDER BY show_title, season, episode, episode_title`).all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id), showId: String(r.show_id), showTitle: String(r.show_title), showDescription: String(r.show_description),
      ...(r.default_language ? { defaultLanguage: String(r.default_language) } : {}), weight: Number(r.weight),
      ...(r.season !== null ? { season: Number(r.season) } : {}), ...(r.episode !== null ? { episode: Number(r.episode) } : {}),
      episodeTitle: String(r.episode_title), description: String(r.description), mediaPath: String(r.media_path),
      durationMs: Number(r.duration_ms), ...(r.audio_language ? { audioLanguage: String(r.audio_language) } : {}),
      subtitles: JSON.parse(String(r.subtitles_json)), technical: JSON.parse(String(r.technical_json)), enabled: Boolean(r.enabled),
    }));
  }

  scheduleBounds(): { firstMs: number; lastMs: number; count: number } | undefined {
    const row = this.db.prepare('SELECT MIN(starts_at_ms) firstMs, MAX(ends_at_ms) lastMs, COUNT(*) count FROM schedule_entries').get() as Record<string, unknown>;
    if (!row.count) return undefined;
    return { firstMs: Number(row.firstMs), lastMs: Number(row.lastMs), count: Number(row.count) };
  }

  lastScheduleEntry(): ScheduleEntry | undefined {
    const row = this.db.prepare('SELECT * FROM schedule_entries ORDER BY sequence DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    return row ? this.mapSchedule(row) : undefined;
  }

  insertSchedule(entries: ScheduleEntry[]): void {
    const insert = this.db.prepare(`INSERT INTO schedule_entries (
      id, sequence, media_id, show_id, show_title, season, episode, episode_title, description,
      starts_at_ms, ends_at_ms, duration_ms, media_path, audio_language, subtitle_languages_json, created_at_ms
    ) VALUES (@id,@sequence,@mediaId,@showId,@showTitle,@season,@episode,@episodeTitle,@description,
      @startsAtMs,@endsAtMs,@durationMs,@mediaPath,@audioLanguage,@subtitleLanguagesJson,@createdAtMs)`);
    this.db.transaction((rows: ScheduleEntry[]) => {
      for (const row of rows) insert.run({
        ...row, season: row.season ?? null, episode: row.episode ?? null, audioLanguage: row.audioLanguage ?? null,
        subtitleLanguagesJson: JSON.stringify(row.subtitleLanguages), createdAtMs: Date.now(),
      });
    })(entries);
  }

  clearSchedule(): void { this.db.prepare('DELETE FROM schedule_entries').run(); }

  currentAt(atMs: number): ScheduleEntry | undefined {
    const row = this.db.prepare('SELECT * FROM schedule_entries WHERE starts_at_ms <= ? AND ends_at_ms > ? ORDER BY starts_at_ms DESC LIMIT 1').get(atMs, atMs) as Record<string, unknown> | undefined;
    return row ? this.mapSchedule(row) : undefined;
  }

  nextAfter(atMs: number): ScheduleEntry | undefined {
    const row = this.db.prepare('SELECT * FROM schedule_entries WHERE starts_at_ms >= ? ORDER BY starts_at_ms LIMIT 1').get(atMs) as Record<string, unknown> | undefined;
    return row ? this.mapSchedule(row) : undefined;
  }

  listSchedule(fromMs: number, toMs: number): ScheduleEntry[] {
    return (this.db.prepare('SELECT * FROM schedule_entries WHERE ends_at_ms > ? AND starts_at_ms < ? ORDER BY starts_at_ms').all(fromMs, toMs) as Array<Record<string, unknown>>).map((r) => this.mapSchedule(r));
  }

  startPlayback(event: PlaybackEvent): void {
    this.db.prepare(`INSERT INTO playback_log (id,schedule_entry_id,planned_start_ms,planned_end_ms,actual_start_ms,actual_end_ms,initial_seek_ms,cold_start_resume,status,error)
      VALUES (@id,@scheduleEntryId,@plannedStartMs,@plannedEndMs,@actualStartMs,@actualEndMs,@initialSeekMs,@coldStartResume,@status,@error)`).run({
        ...event, actualEndMs: event.actualEndMs ?? null, coldStartResume: event.coldStartResume ? 1 : 0, error: event.error ?? null,
      });
  }

  finishPlayback(id: string, status: PlaybackEvent['status'], error?: string): void {
    this.db.prepare('UPDATE playback_log SET actual_end_ms=?, status=?, error=? WHERE id=?').run(Date.now(), status, error ?? null, id);
  }

  listPlayback(fromMs: number, toMs: number): PlaybackEvent[] {
    const rows = this.db.prepare('SELECT * FROM playback_log WHERE planned_end_ms > ? AND planned_start_ms < ? ORDER BY actual_start_ms').all(fromMs, toMs) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id), scheduleEntryId: String(r.schedule_entry_id), plannedStartMs: Number(r.planned_start_ms),
      plannedEndMs: Number(r.planned_end_ms), actualStartMs: Number(r.actual_start_ms),
      ...(r.actual_end_ms !== null ? { actualEndMs: Number(r.actual_end_ms) } : {}), initialSeekMs: Number(r.initial_seek_ms),
      coldStartResume: Boolean(r.cold_start_resume), status: String(r.status) as PlaybackEvent['status'],
      ...(r.error ? { error: String(r.error) } : {}),
    }));
  }

  private mapSchedule(r: Record<string, unknown>): ScheduleEntry {
    return {
      id: String(r.id), sequence: Number(r.sequence), mediaId: String(r.media_id), showId: String(r.show_id),
      showTitle: String(r.show_title), ...(r.season !== null ? { season: Number(r.season) } : {}),
      ...(r.episode !== null ? { episode: Number(r.episode) } : {}), episodeTitle: String(r.episode_title),
      description: String(r.description), startsAtMs: Number(r.starts_at_ms), endsAtMs: Number(r.ends_at_ms),
      durationMs: Number(r.duration_ms), mediaPath: String(r.media_path),
      ...(r.audio_language ? { audioLanguage: String(r.audio_language) } : {}),
      subtitleLanguages: JSON.parse(String(r.subtitle_languages_json)),
    };
  }
}
