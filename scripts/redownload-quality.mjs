// Explicit repair batch: optionally replace validated assets at their existing catalogue paths.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { qualityTransferReservation, isQualityStreamFile } from './quality-transfer-budget.mjs';

const [planPath, releasePath] = process.argv.slice(2);
if (!planPath || !releasePath) throw new Error('Usage: redownload-quality.mjs PLAN ACTIVE_RELEASE');
const replace = process.argv.includes('--replace');
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
for (const row of plan) {
  state.episodes[row.sourceId] = previous.episodes?.[row.sourceId]?.targetHeight === row.targetHeight ? previous.episodes[row.sourceId] : { show: row.show, title: row.title, targetHeight: row.targetHeight, phase: 'queued', attempts: 0 };
  if (!['installed', 'validated', 'retry', 'queued'].includes(state.episodes[row.sourceId].phase)) state.episodes[row.sourceId].phase = 'queued';
}
if (replace) plan.sort((a,b) => {
  const score = row => state.episodes[row.sourceId]?.phase === 'validated' ? state.episodes[row.sourceId].codec === 'h264' ? 0 : 1 : 2;
  return score(a) - score(b);
});
const save = () => { state.updatedAt = Date.now(); fs.writeFileSync(statusPath + '.tmp', JSON.stringify(state, null, 2)); fs.renameSync(statusPath + '.tmp', statusPath); };
save();
let leased = false, heartbeat, leaseLost = false;
const cleanup = () => { io.terminateChildren(); if (leased) store.release(owner); clearInterval(heartbeat); db.close(); };
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { state.phase = 'interrupted'; save(); cleanup(); process.exit(1); });
const check = () => { if (leaseLost) throw new io.Deferred('Lease lost'); guard.check(); };
const downloader = path.join('/home/lundenburg/lundenburg/runtime/tools/yt-dlp/bin/yt-dlp');
const fullProbe = async file => JSON.parse(await io.execute(app.media.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], check, 30000));
const probeHeight = async file => (await fullProbe(file)).streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
const replacement = replace ? await moduleAt('acquisition/quality-replacement.js') : undefined;
const done = entry => entry.phase === (replace ? 'installed' : 'validated');
const finish = async (row, entry, dir) => {
  if (!replace) return;
  entry.phase = 'preparing-replacement'; save();
  const ext = path.extname(row.file), prepared = path.join(dir, `playout${ext}`);
  const protectOriginal = () => { check(); guard.check(row.file); };
  if (replacement.recoverQualityReplacement(db, row.file, dir, protectOriginal)) {
    Object.assign(entry, { phase: 'installed', file: row.file, codec: 'h264' }); save(); return;
  }
  if (!fs.existsSync(prepared)) {
    const stream = await probeHeight(entry.file), partial = path.join(dir, `playout.partial${ext}`);
    const estimate = Math.max(fs.statSync(entry.file).size * 2, Number((await fullProbe(entry.file)).format.duration) * 1500000);
    io.reserve(app.media.root, estimate, policy.reserveBytes);
    const progress = io.progressWatch(() => fs.existsSync(partial) ? fs.statSync(partial).size : 0, policy.downloadStallSeconds);
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(row.file), 'ingest.json'), 'utf8'));
    const videoArgs = stream.codec_name === 'h264' ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-threads', '1', '-pix_fmt', 'yuv420p'];
    await io.execute('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-threads', '1', '-filter_threads', '1', '-i', entry.file,
      '-map', '0:v:0', '-map', '0:a:0', '-map', '0:s?', '-map_metadata', '0', '-map_chapters', '0', ...videoArgs,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-metadata:s:a:0', `language=${manifest.item.audioLanguage ?? 'und'}`, '-c:s', 'copy', partial],
      () => { check(); progress(); io.reserve(app.media.root, 1024 * 1024, policy.reserveBytes); }, 0);
    fs.renameSync(partial, prepared);
  }
  entry.phase = 'awaiting-safe-swap'; save();
  replacement.installQualityReplacement({ db, original: row.file, prepared, dir, sourceId: row.sourceId, targetHeight: row.targetHeight,
    probe: await fullProbe(prepared), guard: protectOriginal });
  Object.assign(entry, { phase: 'installed', file: row.file, codec: 'h264' }); delete entry.reason; save();
  console.log(`Replaced ${row.show} / ${row.sourceId}; old copy and staging files removed.`);
};
try {
  while (!store.acquire(owner, 120000)) await delay(1000);
  leased = true;
  heartbeat = setInterval(() => { try { store.renew(owner, 120000); } catch { leaseLost = true; io.terminateChildren(); } }, 20000);
  state.phase = 'running'; save();
  console.log(`Quality replacement batch started: ${plan.length} episodes; ${replace ? 'automatic replacement enabled' : 'originals retained'}.`);
  // Retry transient extraction failures; healthy transfers have a progress watchdog, not a wall-time limit.
  for (let pass = 0; replace || pass < 3; pass++) {
    for (const row of plan) {
      const entry = state.episodes[row.sourceId];
      if (done(entry)) continue;
      const id = path.basename(path.dirname(row.file));
      const dir = path.join(app.media.root, '.acquisition/staging', `quality-${id}`);
      fs.mkdirSync(dir, { recursive: true });
      try {
        check();
        if (replace && fs.existsSync(path.join(dir, 'swap.json')) && replacement.recoverQualityReplacement(db, row.file, dir, () => { check(); guard.check(row.file); })) {
          Object.assign(entry, { phase: 'installed', file: row.file, codec: 'h264' }); save(); continue;
        }
        const installed = db.db.prepare('SELECT technical_json FROM media_items WHERE media_path=?').get(row.file);
        if (replace && JSON.parse(installed?.technical_json ?? '{}').qualityReplacement?.sourceId === row.sourceId) {
          const stream = await probeHeight(row.file);
          if (stream.height >= row.targetHeight) { fs.rmSync(dir, { recursive: true, force: true }); Object.assign(entry, { phase: 'installed', file: row.file, codec: 'h264' }); save(); continue; }
        }
        let completed = fs.readdirSync(dir).filter(n => /^replacement\.(mkv|mp4|webm|mov)$/.test(n));
        if (!completed.length) {
          const sources = [];
          for (const name of fs.readdirSync(dir).filter(n => /^replacement\.f[\w-]+\.(mp4|webm|m4a)$/.test(n))) {
            const file = path.join(dir, name), probe = await fullProbe(file);
            sources.push({ file, probe, size: fs.statSync(file).size });
          }
          const videos = sources.filter(s => s.probe.streams.some(v => v.codec_type === 'video' && v.height >= row.targetHeight));
          videos.sort((a,b) => Number(b.probe.streams.some(v => v.codec_name === 'h264')) - Number(a.probe.streams.some(v => v.codec_name === 'h264')));
          const video = videos[0], audio = sources.find(s => s.probe.streams.some(a => a.codec_type === 'audio') && !s.probe.streams.some(v => v.codec_type === 'video'));
          if (video && audio) {
            const abandoned = path.join(dir, 'replacement.temp.mkv'); if (fs.existsSync(abandoned)) fs.unlinkSync(abandoned);
            const partial = path.join(dir, 'replacement.mux.partial.mkv'), output = path.join(dir, 'replacement.mkv');
            io.reserve(app.media.root, video.size + audio.size, policy.reserveBytes);
            const progress = io.progressWatch(() => fs.existsSync(partial) ? fs.statSync(partial).size : 0, policy.downloadStallSeconds);
            entry.phase = 'merging-completed-streams'; save();
            console.log(`Recovering completed streams for ${row.show} / ${row.sourceId}; no redownload needed.`);
            await io.execute('ffmpeg', ['-nostdin','-v','error','-y','-threads','1','-i',video.file,'-i',audio.file,'-map','0:v:0','-map','1:a:0','-c','copy',partial], () => { check(); progress(); io.reserve(app.media.root, 1024 * 1024, policy.reserveBytes); }, 0);
            fs.renameSync(partial, output); completed = ['replacement.mkv'];
          }
        }
        if (completed.length === 1) {
          const file = path.join(dir, completed[0]), stream = await probeHeight(file);
          if (!(stream?.height >= row.targetHeight)) throw new Error('Replacement below target');
          Object.assign(entry, { phase: 'validated', file, width: stream.width, height: stream.height, codec: stream.codec_name }); save(); await finish(row, entry, dir); continue;
        }
        entry.phase = 'extracting'; entry.attempts++; save();
        const qualityArgs = ['-f', `bv*[height>=${row.targetHeight}][height<=1080]+ba/b[height>=${row.targetHeight}][height<=1080]`, '--format-sort-force', '-S', 'height,vcodec:h264'];
        const common = [...adapters.extractorArgs('youtube', release), '--ignore-config', '--no-playlist', '--no-geo-bypass', '--no-warnings', '--socket-timeout', String(policy.connectTimeoutSeconds), ...qualityArgs];
        const url = `https://www.youtube.com/watch?v=${row.sourceId}`;
        const metadata = JSON.parse(await io.execute(downloader, [...common, '--dump-single-json', url], check, 60000));
        const sub = policy.subscriptions.find(s => s.id === row.show);
        if (metadata.id !== row.sourceId || metadata.channel_id !== sub.channelId || !(metadata.height >= row.targetHeight)) throw new Error('Source identity or resolution mismatch');
        const estimate = adapters.youtubeEstimatedBytes(metadata, Number(metadata.duration) * 1000);
        const stagedBytes = () => fs.readdirSync(dir).reduce((sum, name) => { const file = path.join(dir, name); return sum + (fs.statSync(file).isFile() ? fs.statSync(file).size : 0); }, 0);
        const streamBytes = () => fs.readdirSync(dir).filter(isQualityStreamFile).reduce((sum,name) => sum + fs.statSync(path.join(dir,name)).size,0);
        const allowance = () => qualityTransferReservation(estimate, streamBytes());
        io.reserve(app.media.root, Math.max(0, allowance() - stagedBytes()), policy.reserveBytes);
        const progress = io.progressWatch(stagedBytes, policy.downloadStallSeconds);
        entry.phase = 'downloading'; save(); console.log(`Downloading ${row.show} / ${row.sourceId} at ${row.targetHeight}p.`);
        await io.execute(downloader, [...common, '--no-progress', '--continue', '--retries', '2', '--fragment-retries', '2', '--concurrent-fragments', '1', '--limit-rate', String(policy.downloadBytesPerSecond), '--merge-output-format', 'mkv', '-o', path.join(dir, 'replacement.%(ext)s'), url], () => {
          check(); progress(); const bytes = stagedBytes(); io.reserve(app.media.root, Math.max(0, allowance() - bytes), policy.reserveBytes);
          if (bytes > allowance()) throw new io.Deferred('Replacement exceeds reservation');
          entry.downloadedBytes = bytes; save();
        }, 0);
        const files = fs.readdirSync(dir).filter(n => /^replacement\.(mkv|mp4|webm|mov)$/.test(n));
        if (files.length !== 1) throw new Error('Missing completed replacement');
        const file = path.join(dir, files[0]), stream = await probeHeight(file);
        if (!(stream?.height >= row.targetHeight)) throw new Error('Replacement below target');
        Object.assign(entry, { phase: 'validated', file, width: stream.width, height: stream.height, codec: stream.codec_name }); save();
        console.log(`Validated ${row.show} / ${row.sourceId}: ${stream.width}x${stream.height}.`);
        await finish(row, entry, dir);
      } catch (error) {
        entry.phase = 'retry'; entry.reason = error instanceof io.Deferred ? ['Replacement exceeds reservation','Minimum disk-space reserve would be breached','Playout is stale, behind, or awaiting its next asset','Media processing stalled; retry scheduled','yt-dlp timed out','Asset is playing or inside the protected playout window'].includes(error.message) ? error.message : 'Protection or resource check deferred transfer' : error instanceof adapters.AcquisitionCommandError ? `Downloader ${error.kind}` : 'Source extraction, preparation or validation failed'; save();
        console.log(`Deferred ${row.show} / ${row.sourceId}; originals retained.`);
      }
    }
    if (Object.values(state.episodes).every(done)) break;
    if (replace || pass < 2) await delay(replace ? 60000 : 30000);
  }
  state.phase = Object.values(state.episodes).every(done) ? 'complete' : 'needs-retry'; save();
  console.log(`Batch ${state.phase}; ${Object.values(state.episodes).filter(done).length}/${plan.length} ${replace ? 'installed' : 'validated'}.`);
} finally { cleanup(); }
