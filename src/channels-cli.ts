import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Command } from 'commander';
import { parse, stringify } from 'yaml';
import { loadConfig } from './config.js';
import { LkpDatabase } from './database.js';
import { mediaPolicy, profileWindow, validateMediaPolicy } from './channels.js';
import { stationAssets } from './channel-schedule.js';
import { buildScheduleEntries, schedulePlanning, validateTimeline } from './schedule.js';
import { writeEpgAtomic } from './epg.js';
import { readPlayoutStatus } from './playout-status.js';
import { programmeBlocks } from './branding/identity.js';

export function registerChannels(program: Command): void {
  const channels = program.command('channels').description('shared LKP/LN identity, age recommendations and guarded activation');
  const context = () => {
    const app = loadConfig(program.opts<{ config?: string }>().config);
    if (!app.station) throw new Error('Channel profiles are not configured');
    return { app, db: new LkpDatabase(app.storage.database) };
  };
  channels.command('status').action(() => {
    const { app, db } = context();
    try {
      let assetsReady = false; try { stationAssets(app); assetsReady = true; } catch {}
      console.log(JSON.stringify({ enabled: app.station!.enabled, window: profileWindow(Date.now(), app.station!), assetsReady,
        serviceName: app.channel.name, pendingRatings: db.listMedia(false).filter(m => mediaPolicy(m, app.station).recommendedAge === null).length,
        playout: readPlayoutStatus(path.join(app.storage.runtimeDirectory, 'playout-status.json')) }, null, 2));
    } finally { db.close(); }
  });
  channels.command('ratings').option('--apply', 'persist editorial recommendations with a SQLite backup').action(async (options: { apply?: boolean }) => {
    const { app, db } = context();
    try {
      const shows = [...new Map(db.listMedia(false).map(m => [m.showId, m])).values()];
      const rows = shows.map(m => ({ id: m.showId, title: m.showTitle, ...mediaPolicy(m, app.station) }));
      if (options.apply) {
        const backup = `${app.storage.database}.before-channel-ratings-${Date.now()}.sqlite`;
        await db.db.backup(backup); fs.chmodSync(backup, 0o600);
        db.db.transaction(() => {
          const write = db.db.prepare('INSERT INTO show_broadcast_policies VALUES(?,?,?) ON CONFLICT(show_id) DO UPDATE SET policy_json=excluded.policy_json,updated_at_ms=excluded.updated_at_ms');
          for (const row of rows) { const { id, title: _title, ...policy } = row; write.run(id, JSON.stringify(validateMediaPolicy(policy)), Date.now()); }
        })();
      }
      console.log(JSON.stringify({ kind: 'editorial recommendations; not official age ratings', applied: Boolean(options.apply), shows: rows }, null, 2));
    } finally { db.close(); }
  });
  channels.command('policy <show> <file>').description('set a reviewed show policy from JSON or YAML').action((show: string, file: string) => {
    const { db } = context();
    try {
      const policy = validateMediaPolicy(parse(fs.readFileSync(file, 'utf8')));
      if (!db.listMedia(false).some(m => m.showId === show)) throw new Error('Unknown show');
      db.db.prepare('INSERT INTO show_broadcast_policies VALUES(?,?,?) ON CONFLICT(show_id) DO UPDATE SET policy_json=excluded.policy_json,updated_at_ms=excluded.updated_at_ms').run(show, JSON.stringify(policy), Date.now());
      console.log('Show policy saved; guarded schedule regeneration applies it to future programming.');
    } finally { db.close(); }
  });
  channels.command('pin <mediaId>').option('--off', 'remove a manual storage pin').action((id: string, options: { off?: boolean }) => {
    const { app, db } = context();
    try {
      const item = db.listMedia(false).find(m => m.id === id); if (!item) throw new Error('Unknown media item');
      db.upsertMedia([{ ...item, broadcast: { ...mediaPolicy(item, app.station), pinned: !options.off } }]);
      console.log(options.off ? 'Storage pin removed.' : 'Media pinned.');
    } finally { db.close(); }
  });
  channels.command('assets <manifest>').description('validate finished 1080p masters and atomically activate their inventory').action((file: string) => {
    const { app, db } = context();
    try {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.fps !== app.video.fps) throw new Error('Invalid candidate master inventory');
      for (const a of manifest.assets) {
        const probe = JSON.parse(execFileSync(app.media.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', a.path], { encoding: 'utf8', timeout: 30000 }));
        const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video'), audio = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
        const rate = String(v?.avg_frame_rate).split('/').map(Number);
        if (v?.codec_name !== 'h264' || v.width !== 1920 || v.height !== 1080 || v.pix_fmt !== 'yuv420p' || rate[0]! / rate[1]! !== app.video.fps ||
          audio?.codec_name !== 'aac' || audio.sample_rate !== '48000' || audio.channels !== 2 || Math.abs(Number(probe.format.duration) * 1000 - a.durationMs) > 100) throw new Error('Station asset failed media validation');
        a.sha256 = crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex');
      }
      for (const id of ['evening', 'morning', 'ident', 'outro', 'continuity', 'day-continuity', ...Object.keys(programmeBlocks).map(b => `intro-${b}`)]) {
        if (!manifest.assets.some((a: { id: string }) => a.id === id)) throw new Error(`Missing presentation master: ${id}`);
      }
      manifest.status = 'ready';
      const destination = app.station!.assetManifest, temporary = `${destination}.${process.pid}.tmp`;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2)); fs.renameSync(temporary, destination);
      stationAssets(app); console.log('Station presentation inventory validated and activated.');
    } finally { db.close(); }
  });
  channels.command('preview').option('--days <days>', 'days to plan into an isolated artifact', Number, 7).action((options: { days: number }) => {
    const { app, db } = context();
    try {
      if (!Number.isInteger(options.days) || options.days < 1 || options.days > 31) throw new Error('Preview horizon must be 1–31 days');
      app.station!.enabled = true;
      const now = Date.now();
      const rows = buildScheduleEntries(db.listMedia(), app.schedule.seed, now, now + options.days * 86400_000, 0, [], schedulePlanning(db, app));
      if (validateTimeline(rows).length) throw new Error('Invalid preview timeline');
      const output = path.join(app.storage.runtimeDirectory, 'ln-schedule-preview.json');
      fs.writeFileSync(output, JSON.stringify(rows, null, 2)); console.log(output);
    } finally { db.close(); }
  });
  channels.command('activate').description('back up and replace only a guarded future tail with the combined station schedule').action(async () => {
    const { app, db } = context();
    try {
      stationAssets(app);
      const status = readPlayoutStatus(path.join(app.storage.runtimeDirectory, 'playout-status.json'));
      if (status?.state === 'running' && !status.stale && !status.capabilities?.includes('channel-profiles-v1')) throw new Error('The running broadcaster must first load the updated playout code; the existing broadcast and configuration were retained');
      app.station!.enabled = true;
      const bounds = db.scheduleBounds(); if (!bounds) throw new Error('Existing station schedule is required');
      let protectedUntil = Date.now() + app.station!.storage.imminentMinutes * 60000;
      for (const id of [status?.current?.scheduleEntryId, status?.next?.scheduleEntryId]) {
        const row = id ? db.db.prepare('SELECT ends_at_ms FROM schedule_entries WHERE id=?').get(id.split(':')[0]!) as { ends_at_ms: number } | undefined : undefined;
        protectedUntil = Math.max(protectedUntil, row?.ends_at_ms ?? 0);
      }
      const boundary = db.nextAfter(protectedUntil); if (!boundary) throw new Error('No guarded future boundary');
      const prefix = db.listSchedule(bounds.firstMs, boundary.startsAtMs), future = db.listSchedule(boundary.startsAtMs, bounds.lastMs + 1);
      const rows = buildScheduleEntries(db.listMedia(), app.schedule.seed, boundary.startsAtMs, bounds.lastMs, boundary.sequence, prefix,
        { ...schedulePlanning(db, app), reserved: future.filter(e => e.showId === 'lkp-weather') });
      if (validateTimeline([...prefix.slice(-1), ...rows]).length) throw new Error('Invalid combined station timeline');
      const backup = `${app.storage.database}.before-nacht-${Date.now()}.sqlite`; await db.db.backup(backup); fs.chmodSync(backup, 0o600);
      const stationFile = path.join(app.projectRoot, 'config/channels.yaml'), saved = fs.readFileSync(stationFile, 'utf8');
      const raw = parse(saved); raw.enabled = true; raw.activateAtMs = boundary.startsAtMs;
      db.db.transaction(() => {
        if (db.nextAfter(boundary.startsAtMs)?.id !== boundary.id) throw new Error('Schedule changed during channel activation');
        db.db.prepare('DELETE FROM schedule_entries WHERE sequence>=?').run(boundary.sequence); db.insertSchedule(rows);
        const temporary = `${stationFile}.tmp`; fs.writeFileSync(temporary, stringify(raw)); fs.renameSync(temporary, stationFile);
      }).immediate();
      writeEpgAtomic(db.listSchedule(Date.now() - 86400_000, Date.now() + app.schedule.epgDays * 86400_000), app);
      console.log(JSON.stringify({ activeFrom: new Date(boundary.startsAtMs).toISOString(), entries: rows.length, backup }));
    } finally { db.close(); }
  });
}
