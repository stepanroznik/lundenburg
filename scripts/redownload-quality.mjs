// Explicit repair batch: download validated replacements without changing originals or schedules.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const [planPath, releasePath] = process.argv.slice(2);
if (!planPath || !releasePath) throw new Error('Usage: redownload-quality.mjs PLAN ACTIVE_RELEASE');
const release = fs.realpathSync(releasePath);
const moduleAt = name => import(pathToFileURL(path.join(release, 'dist/src', name)));
const [{ loadConfig }, { loadAcquisitionConfig }, { LkpDatabase }, { AcquisitionStore }, io, adapters] = await Promise.all([
  moduleAt('config.js'), moduleAt('acquisition/model.js'), moduleAt('database.js'), moduleAt('acquisition/store.js'), moduleAt('acquisition/io.js'), moduleAt('acquisition/adapters.js'),
]);
const app = loadConfig(path.join(release, 'config/lkp.yaml'));
const policy = loadAcquisitionConfig(app, path.join(release, 'config/content-acquisition.yaml'));
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
if (!Array.isArray(plan) || !plan.length) throw new Error('Replacement plan is empty');
for (const row of plan) {
  if (!/^[\w-]{11}$/.test(row.sourceId) || !Number.isInteger(row.targetHeight) || row.targetHeight < 480 || row.targetHeight > 1080 ||
      !policy.subscriptions.some(s => s.id === row.show && s.source === 'youtube') ||
      !path.resolve(row.file).startsWith(path.join(app.media.root, row.show, 'acquired') + path.sep)) throw new Error('Invalid replacement plan');
  const provenance = JSON.parse(fs.readFileSync(path.join(path.dirname(row.file), 'ingest.json'), 'utf8')).candidate;
  if (provenance.sourceId !== row.sourceId || provenance.showId !== row.show) throw new Error('Replacement identity mismatch');
}
const db = new LkpDatabase(app.storage.database), store = new AcquisitionStore(db);
const owner = `${process.pid}:quality-redownload`;
const guard = new io.BroadcastGuard(app, db, policy, Infinity);
const runtime = path.join('/home/lundenburg/lundenburg/runtime', 'quality-redownload');
fs.mkdirSync(runtime, { recursive: true });
const statusPath = path.join(runtime, 'status.json');
let previous = {}; try { previous = JSON.parse(fs.readFileSync(statusPath, 'utf8')); } catch {}
const state = { pid: process.pid, phase: 'waiting-for-lease', total: plan.length, updatedAt: Date.now(), episodes: {} };
for (const row of plan) state.episodes[row.sourceId] = previous.episodes?.[row.sourceId]?.targetHeight === row.targetHeight ? previous.episodes[row.sourceId] : { show: row.show, title: row.title, targetHeight: row.targetHeight, phase: 'queued', attempts: 0 };
const save = () => { state.updatedAt = Date.now(); fs.writeFileSync(statusPath + '.tmp', JSON.stringify(state, null, 2)); fs.renameSync(statusPath + '.tmp', statusPath); };
save();
let leased = false, heartbeat, leaseLost = false;
const cleanup = () => { io.terminateChildren(); if (leased) store.release(owner); clearInterval(heartbeat); db.close(); };
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { state.phase = 'interrupted'; save(); cleanup(); process.exit(1); });
const check = () => { if (leaseLost) throw new io.Deferred('Lease lost'); guard.check(); };
const downloader = path.join('/home/lundenburg/lundenburg/runtime/tools/yt-dlp/bin/yt-dlp');
const probeHeight = async file => {
  const probe = JSON.parse(await io.execute(app.media.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height,width,codec_name', '-of', 'json', file], check, 30000));
  return probe.streams?.[0];
};
try {
  while (!store.acquire(owner, 120000)) await delay(1000);
  leased = true;
  heartbeat = setInterval(() => { try { store.renew(owner, 120000); } catch { leaseLost = true; io.terminateChildren(); } }, 20000);
  state.phase = 'running'; save();
  console.log(`Quality replacement batch started: ${plan.length} episodes; originals retained.`);
  // Retry transient extraction failures; healthy transfers have a progress watchdog, not a wall-time limit.
  for (let pass = 0; pass < 3; pass++) {
    for (const row of plan) {
      const entry = state.episodes[row.sourceId];
      const id = path.basename(path.dirname(row.file));
      const dir = path.join(app.media.root, '.acquisition/staging', `quality-${id}`);
      fs.mkdirSync(dir, { recursive: true });
      try {
        check();
        const completed = fs.readdirSync(dir).filter(n => /^replacement\.(mkv|mp4|webm|mov)$/.test(n));
        if (completed.length === 1) {
          const file = path.join(dir, completed[0]), stream = await probeHeight(file);
          if (!(stream?.height >= row.targetHeight)) throw new Error('Replacement below target');
          Object.assign(entry, { phase: 'validated', file, width: stream.width, height: stream.height, codec: stream.codec_name }); save(); continue;
        }
        entry.phase = 'extracting'; entry.attempts++; save();
        const qualityArgs = ['-f', `bv*[height>=${row.targetHeight}][height<=1080]+ba/b[height>=${row.targetHeight}][height<=1080]`, '--format-sort-force', '-S', 'height,vcodec:h264'];
        const common = [...adapters.extractorArgs('youtube', release), '--ignore-config', '--no-playlist', '--no-geo-bypass', '--no-warnings', '--socket-timeout', String(policy.connectTimeoutSeconds), ...qualityArgs];
        const url = `https://www.youtube.com/watch?v=${row.sourceId}`;
        const metadata = JSON.parse(await io.execute(downloader, [...common, '--dump-single-json', url], check, 60000));
        const sub = policy.subscriptions.find(s => s.id === row.show);
        if (metadata.id !== row.sourceId || metadata.channel_id !== sub.channelId || !(metadata.height >= row.targetHeight)) throw new Error('Source identity or resolution mismatch');
        const estimate = adapters.youtubeEstimatedBytes(metadata, Number(metadata.duration) * 1000);
        io.reserve(app.media.root, estimate * 2, policy.reserveBytes);
        const stagedBytes = () => fs.readdirSync(dir).reduce((sum, name) => { const file = path.join(dir, name); return sum + (fs.statSync(file).isFile() ? fs.statSync(file).size : 0); }, 0);
        const progress = io.progressWatch(stagedBytes, policy.downloadStallSeconds);
        entry.phase = 'downloading'; save(); console.log(`Downloading ${row.show} / ${row.sourceId} at ${row.targetHeight}p.`);
        await io.execute(downloader, [...common, '--no-progress', '--continue', '--retries', '2', '--fragment-retries', '2', '--concurrent-fragments', '1', '--limit-rate', String(policy.downloadBytesPerSecond), '--merge-output-format', 'mkv', '-o', path.join(dir, 'replacement.%(ext)s'), url], () => {
          check(); progress(); const bytes = stagedBytes(); io.reserve(app.media.root, Math.max(0, estimate - bytes), policy.reserveBytes);
          if (bytes > estimate * 1.25) throw new io.Deferred('Replacement exceeds reservation');
          entry.downloadedBytes = bytes; save();
        }, 0);
        const files = fs.readdirSync(dir).filter(n => /^replacement\.(mkv|mp4|webm|mov)$/.test(n));
        if (files.length !== 1) throw new Error('Missing completed replacement');
        const file = path.join(dir, files[0]), stream = await probeHeight(file);
        if (!(stream?.height >= row.targetHeight)) throw new Error('Replacement below target');
        Object.assign(entry, { phase: 'validated', file, width: stream.width, height: stream.height, codec: stream.codec_name }); save();
        console.log(`Validated ${row.show} / ${row.sourceId}: ${stream.width}x${stream.height}.`);
      } catch (error) {
        entry.phase = 'retry'; entry.reason = error instanceof io.Deferred ? 'Protection or resource check deferred transfer' : 'Source extraction or validation failed'; save();
        console.log(`Deferred ${row.show} / ${row.sourceId}; originals retained.`);
      }
    }
    if (Object.values(state.episodes).every(e => e.phase === 'validated')) break;
    if (pass < 2) await delay(30000);
  }
  state.phase = Object.values(state.episodes).every(e => e.phase === 'validated') ? 'complete' : 'needs-retry'; save();
  console.log(`Batch ${state.phase}; ${Object.values(state.episodes).filter(e => e.phase === 'validated').length}/${plan.length} validated.`);
} finally { cleanup(); }
