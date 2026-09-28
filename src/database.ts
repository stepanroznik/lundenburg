import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AdAsset, MediaItem, PlaybackEvent, ScheduleEntry } from './types.js';

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
      CREATE TABLE IF NOT EXISTS shows (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        default_language TEXT, weight REAL NOT NULL, enabled INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY, show_id TEXT NOT NULL REFERENCES shows(id), season INTEGER,
        episode INTEGER, title TEXT NOT NULL, description TEXT NOT NULL, external_ids_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(id), path TEXT NOT NULL UNIQUE,
        source_filename TEXT NOT NULL, duration_ms INTEGER NOT NULL, technical_json TEXT NOT NULL,
        effective_editorial_duration_ms INTEGER NOT NULL, credits_policy TEXT NOT NULL,
        ingest_state TEXT NOT NULL, qc_warnings_json TEXT NOT NULL, enabled INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subtitle_tracks (
        media_asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, language TEXT NOT NULL, kind TEXT NOT NULL, metadata_json TEXT NOT NULL,
        PRIMARY KEY(media_asset_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS editorial_markers (
        media_asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, kind TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER,
        source TEXT NOT NULL, confidence REAL NOT NULL, metadata_json TEXT NOT NULL,
        PRIMARY KEY(media_asset_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS ad_assets (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, advertiser TEXT, source_url TEXT NOT NULL UNIQUE,
        language TEXT NOT NULL, duration_ms INTEGER NOT NULL, media_path TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL, tags_json TEXT NOT NULL, age_suitability TEXT,
        source_metadata_json TEXT NOT NULL, last_used_at_ms INTEGER, ingested_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL
      );
    `);
    this.ensureColumn('media_items', 'external_ids_json', "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn('media_items', 'editorial_markers_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn('media_items', 'credits_policy', "TEXT NOT NULL DEFAULT 'full'");
    this.ensureColumn('media_items', 'effective_editorial_duration_ms', 'INTEGER');
    this.ensureColumn('media_items', 'breakpoints_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn('media_items', 'ingest_state', "TEXT NOT NULL DEFAULT 'review'");
    this.ensureColumn('media_items', 'qc_warnings_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn('schedule_entries', 'listing_visibility', "TEXT NOT NULL DEFAULT 'public'");
    this.ensureColumn('schedule_entries', 'playout_plan_json', 'TEXT');
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES(2, ?)').run(Date.now());
  }

  private ensureColumn(table: string, column: string, declaration: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }

  replaceMedia(items: MediaItem[]): void {
    const upsert = this.db.prepare(`
      INSERT INTO media_items (
        id, show_id, show_title, show_description, default_language, weight, season, episode,
        episode_title, description, media_path, duration_ms, audio_language, subtitles_json,
        technical_json, enabled, scanned_at_ms, external_ids_json, editorial_markers_json,
        credits_policy, effective_editorial_duration_ms, breakpoints_json, ingest_state, qc_warnings_json
      ) VALUES (
        @id, @showId, @showTitle, @showDescription, @defaultLanguage, @weight, @season, @episode,
        @episodeTitle, @description, @mediaPath, @durationMs, @audioLanguage, @subtitlesJson,
        @technicalJson, @enabled, @scannedAtMs, @externalIdsJson, @editorialMarkersJson,
        @creditsPolicy, @effectiveEditorialDurationMs, @breakpointsJson, @ingestState, @qcWarningsJson
      ) ON CONFLICT(id) DO UPDATE SET
        show_id=excluded.show_id, show_title=excluded.show_title, show_description=excluded.show_description,
        default_language=excluded.default_language, weight=excluded.weight, season=excluded.season,
        episode=excluded.episode, episode_title=excluded.episode_title, description=excluded.description,
        media_path=excluded.media_path, duration_ms=excluded.duration_ms, audio_language=excluded.audio_language,
        subtitles_json=excluded.subtitles_json, technical_json=excluded.technical_json,
        enabled=excluded.enabled, scanned_at_ms=excluded.scanned_at_ms, external_ids_json=excluded.external_ids_json,
        editorial_markers_json=excluded.editorial_markers_json, credits_policy=excluded.credits_policy, effective_editorial_duration_ms=excluded.effective_editorial_duration_ms, breakpoints_json=excluded.breakpoints_json, ingest_state=excluded.ingest_state, qc_warnings_json=excluded.qc_warnings_json
    `);
    const upsertShow = this.db.prepare('INSERT INTO shows(id,title,description,default_language,weight,enabled) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,default_language=excluded.default_language,weight=excluded.weight,enabled=excluded.enabled');
    const upsertEpisode = this.db.prepare('INSERT INTO episodes(id,show_id,season,episode,title,description,external_ids_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET show_id=excluded.show_id,season=excluded.season,episode=excluded.episode,title=excluded.title,description=excluded.description,external_ids_json=excluded.external_ids_json');
    const upsertAsset = this.db.prepare('INSERT INTO media_assets(id,episode_id,path,source_filename,duration_ms,technical_json,effective_editorial_duration_ms,credits_policy,ingest_state,qc_warnings_json,enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET episode_id=excluded.episode_id,path=excluded.path,source_filename=excluded.source_filename,duration_ms=excluded.duration_ms,technical_json=excluded.technical_json,effective_editorial_duration_ms=excluded.effective_editorial_duration_ms,credits_policy=excluded.credits_policy,ingest_state=excluded.ingest_state,qc_warnings_json=excluded.qc_warnings_json,enabled=excluded.enabled');
    const deleteSubtitles = this.db.prepare('DELETE FROM subtitle_tracks WHERE media_asset_id=?');
    const insertSubtitle = this.db.prepare('INSERT INTO subtitle_tracks(media_asset_id,ordinal,language,kind,metadata_json) VALUES(?,?,?,?,?)');
    const deleteMarkers = this.db.prepare('DELETE FROM editorial_markers WHERE media_asset_id=?');
    const insertMarker = this.db.prepare('INSERT INTO editorial_markers(media_asset_id,ordinal,kind,start_ms,end_ms,source,confidence,metadata_json) VALUES(?,?,?,?,?,?,?,?)');
    const transaction = this.db.transaction((rows: MediaItem[]) => {
      const scannedAtMs = Date.now();
      const ids = new Set(rows.map((row) => row.id));
      for (const row of rows) { upsert.run({
        ...row,
        defaultLanguage: row.defaultLanguage ?? null,
        season: row.season ?? null,
        episode: row.episode ?? null,
        audioLanguage: row.audioLanguage ?? null,
        subtitlesJson: JSON.stringify(row.subtitles),
        technicalJson: JSON.stringify(row.technical),
        externalIdsJson: JSON.stringify(row.externalIds ?? {}),
        editorialMarkersJson: JSON.stringify(row.editorialMarkers ?? []),
        creditsPolicy: row.creditsPolicy ?? 'full',
        effectiveEditorialDurationMs: row.effectiveEditorialDurationMs ?? row.durationMs,
        breakpointsJson: JSON.stringify(row.breakpoints ?? []),
        ingestState: row.ingestState ?? 'review',
        qcWarningsJson: JSON.stringify(row.qcWarnings ?? []),
        enabled: row.enabled ? 1 : 0,
        scannedAtMs,
      });
        upsertShow.run(row.showId, row.showTitle, row.showDescription, row.defaultLanguage ?? null, row.weight, row.enabled ? 1 : 0);
        upsertEpisode.run(row.id, row.showId, row.season ?? null, row.episode ?? null, row.episodeTitle, row.description, JSON.stringify(row.externalIds ?? {}));
        upsertAsset.run(row.id, row.id, row.mediaPath, path.basename(row.mediaPath), row.durationMs, JSON.stringify(row.technical), row.effectiveEditorialDurationMs ?? row.durationMs, row.creditsPolicy ?? 'full', row.ingestState ?? 'review', JSON.stringify(row.qcWarnings ?? []), row.enabled ? 1 : 0);
        deleteSubtitles.run(row.id);
        row.subtitles.forEach((track, ordinal) => insertSubtitle.run(row.id, ordinal, track.language, track.kind, JSON.stringify(track)));
        deleteMarkers.run(row.id);
        (row.editorialMarkers ?? []).forEach((marker, ordinal) => insertMarker.run(row.id, ordinal, marker.kind, marker.startMs, marker.endMs ?? null, marker.source, marker.confidence, JSON.stringify(marker)));
      }
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
      externalIds: JSON.parse(String(r.external_ids_json ?? '{}')),
      editorialMarkers: JSON.parse(String(r.editorial_markers_json ?? '[]')),
      creditsPolicy: String(r.credits_policy ?? 'full') as NonNullable<MediaItem['creditsPolicy']>,
      effectiveEditorialDurationMs: Number(r.effective_editorial_duration_ms ?? r.duration_ms),
      breakpoints: JSON.parse(String(r.breakpoints_json ?? '[]')),
      ingestState: String(r.ingest_state ?? 'review') as NonNullable<MediaItem['ingestState']>,
      qcWarnings: JSON.parse(String(r.qc_warnings_json ?? '[]')),
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
      starts_at_ms, ends_at_ms, duration_ms, media_path, audio_language, subtitle_languages_json, listing_visibility, playout_plan_json, created_at_ms
    ) VALUES (@id,@sequence,@mediaId,@showId,@showTitle,@season,@episode,@episodeTitle,@description,
      @startsAtMs,@endsAtMs,@durationMs,@mediaPath,@audioLanguage,@subtitleLanguagesJson,@listingVisibility,@playoutPlanJson,@createdAtMs)`);
    this.db.transaction((rows: ScheduleEntry[]) => {
      for (const row of rows) insert.run({
        ...row, season: row.season ?? null, episode: row.episode ?? null, audioLanguage: row.audioLanguage ?? null,
        subtitleLanguagesJson: JSON.stringify(row.subtitleLanguages), createdAtMs: Date.now(),
        listingVisibility: row.listingVisibility ?? 'public', playoutPlanJson: row.playoutPlan ? JSON.stringify(row.playoutPlan) : null,
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

  upsertAd(ad: AdAsset): void {
    this.db.prepare(`INSERT INTO ad_assets (
      id,title,advertiser,source_url,language,duration_ms,media_path,enabled,tags_json,
      age_suitability,source_metadata_json,last_used_at_ms,ingested_at_ms
    ) VALUES (@id,@title,@advertiser,@sourceUrl,@language,@durationMs,@mediaPath,@enabled,@tagsJson,
      @ageSuitability,@sourceMetadataJson,@lastUsedAtMs,@ingestedAtMs)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,advertiser=excluded.advertiser,source_url=excluded.source_url,
      language=excluded.language,duration_ms=excluded.duration_ms,media_path=excluded.media_path,enabled=excluded.enabled,
      tags_json=excluded.tags_json,age_suitability=excluded.age_suitability,source_metadata_json=excluded.source_metadata_json`).run({
      ...ad, advertiser: ad.advertiser ?? null, enabled: ad.enabled ? 1 : 0, tagsJson: JSON.stringify(ad.tags),
      ageSuitability: ad.ageSuitability ?? null, sourceMetadataJson: JSON.stringify(ad.sourceMetadata),
      lastUsedAtMs: ad.lastUsedAtMs ?? null, ingestedAtMs: Date.now(),
    });
  }

  listAds(enabledOnly = true): AdAsset[] {
    const rows = this.db.prepare(`SELECT * FROM ad_assets ${enabledOnly ? 'WHERE enabled=1' : ''} ORDER BY id`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), title: String(row.title), ...(row.advertiser ? { advertiser: String(row.advertiser) } : {}),
      sourceUrl: String(row.source_url), language: String(row.language), durationMs: Number(row.duration_ms),
      mediaPath: String(row.media_path), enabled: Boolean(row.enabled), tags: JSON.parse(String(row.tags_json)),
      ...(row.age_suitability ? { ageSuitability: String(row.age_suitability) } : {}),
      sourceMetadata: JSON.parse(String(row.source_metadata_json)),
      ...(row.last_used_at_ms !== null ? { lastUsedAtMs: Number(row.last_used_at_ms) } : {}),
    }));
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
      listingVisibility: String(r.listing_visibility ?? 'public') as NonNullable<ScheduleEntry['listingVisibility']>,
      ...(r.playout_plan_json ? { playoutPlan: JSON.parse(String(r.playout_plan_json)) } : {}),
    };
  }
}
