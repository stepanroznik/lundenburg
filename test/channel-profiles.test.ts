import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { config, item } from './helpers.js';
import { channelEntryAllowed, eligibleFor, loadStationConfig, mediaPolicy, profileWindow, validateMediaPolicy } from '../src/channels.js';
import { buildScheduleEntries, schedulePlanning, validateTimeline } from '../src/schedule.js';
import { LkpDatabase } from '../src/database.js';
import { generateEpgXml } from '../src/epg.js';
import { fitNightTail } from '../src/channel-schedule.js';
import { buildFfmpegArgs } from '../src/playout.js';
import { prepareLogo } from '../src/logo.js';
import { AcquisitionStore } from '../src/acquisition/store.js';
import { NachtStorage } from '../src/acquisition/nacht-storage.js';
import { NachtClassifier, breclavBulletin, unusualEpisode, deterministicNacht, nachtPolicy, validateNachtClassification, classifyNachtPending, type NachtClassification } from '../src/acquisition/nacht-classification.js';
import { loadAcquisitionConfig, type Candidate } from '../src/acquisition/model.js';
import { regionalRelevance } from '../src/acquisition/regional.js';
import { discoverYoutube } from '../src/acquisition/adapters.js';
import type { MediaBroadcastPolicy, StationConfig } from '../src/types.js';

const project = path.resolve('.');
const ms = (s: string) => DateTime.fromISO(s, { zone: 'Europe/Prague' }).toMillis();
const policy = (category = 'science', retention: MediaBroadcastPolicy['retention'] = 'standard'): MediaBroadcastPolicy => ({ profiles: ['ln'], recommendedAge: 16,
  ratingSource: 'editorial', category, topics: [], intensity: category === 'regional' ? 'calm' : 'moderate', timeOfNight: 'any', retention, priority: 50 });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ln-profiles-')), app = config(root);
  fs.mkdirSync(app.media.root, { recursive: true });
  app.station = loadStationConfig(project)!; app.station.enabled = true; app.station.avoidHandoverLogoPadding=false;
  app.station.assetManifest = path.join(root, 'presentation.json');
  app.station.storage = { maxBytes: 100000, reserveBytes: 1, imminentMinutes: 30 };
  const video = path.join(root, 'presentation.mp4'); fs.writeFileSync(video, 'fixture');
  const assets = ['evening', 'morning', 'ident', 'outro', 'continuity', 'day-continuity', 'intro-neugierig', 'intro-heimat', 'intro-internet', 'intro-aktuell', 'intro-geschichte', 'intro-kino'].map(id => ({ id, path: video,
    durationMs: ['evening', 'morning'].includes(id) ? 10000 : id === 'continuity' ? 30000 : 4000, fullScreen: true, destination: id === 'morning' ? 'lkp' : 'ln' }));
  fs.writeFileSync(app.station.assetManifest, JSON.stringify({ version: 1, status: 'ready', fps: 30, assets }));
  const db = new LkpDatabase(app.storage.database);
  return { root, app, db, close: () => { db.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('profile windows follow evening-start weekdays and civil DST dates after restarts', () => {
  const station = loadStationConfig(project)!;
  for (const [date, expected] of [
    ['2026-10-23T19:59:59', 'lkp'], ['2026-10-23T20:00:00', 'ln'], ['2026-10-24T00:05:00', 'ln'],
    ['2026-10-24T20:59:59', 'lkp'], ['2026-10-24T21:00:00', 'ln'], ['2026-10-25T05:59:59', 'ln'], ['2026-10-25T06:00:00', 'lkp'],
  ]) assert.equal(profileWindow(ms(date!), station).profile, expected);
  const spring = profileWindow(ms('2026-03-29T03:30:00'), station), autumn = profileWindow(ms('2026-10-25T03:30:00'), station);
  assert.equal(spring.endsAtMs - spring.startsAtMs, 8 * 3600000);
  assert.equal(autumn.endsAtMs - autumn.startsAtMs, 10 * 3600000);
  assert.equal(DateTime.fromMillis(spring.endsAtMs, { zone: station.timezone }).hour, 6);
  assert.equal(profileWindow(ms('2026-10-24T02:00:00'), station).startsAtMs, ms('2026-10-23T20:00:00'));
});

test('age recommendations and eligibility keep adult acquisitions out of legacy children’s scheduling', () => {
  const station = loadStationConfig(project)!;
  assert.deepEqual(mediaPolicy(item('byl-jednou-jeden-zivot', 1), station).profiles, ['lkp', 'ln']);
  assert.equal(eligibleFor(item('the-man-from-earth', 1), 'lkp', station), false);
  const adult = { ...item('adult', 1), technical: { acquisition: { profile: 'ln' } } };
  assert.equal(eligibleFor(adult, 'lkp'), false);
  assert.equal(eligibleFor(adult, 'ln'), true);
  assert.throws(() => validateMediaPolicy({ ...policy(), profiles: ['lkp'] }));
});

test('one timeline has exact handovers, dated local news, quiet hours, fair collection rotation and no night ads', t => {
  const f = fixture();
  try {
    const kids = item('a', 1, 7 * 60_000);
    const science = { ...item('science', 1, 12 * 60_000), broadcast: policy() };
    const quiet = { ...item('regional', 1, 38 * 60_000), broadcast: policy('regional') };
    const news = { ...item('news', 1, 9 * 60_000), broadcast: policy('news', 'latest-only'), technical: { acquisition: { publishedAt: ms('2026-09-02T12:00:00') } } };
    const memes = [1, 2, 3].map(n => ({ ...item('unusual', n, 4 * 60_000), broadcast: policy('comedy', 'protected') }));
    f.db.upsertMedia([kids, science, quiet, news, ...memes]);
    const entries = buildScheduleEntries(f.db.listMedia(), 'night-fixture', ms('2026-10-23T19:45:00'), ms('2026-10-24T06:00:01'), 0, [], schedulePlanning(f.db, f.app));
    assert.deepEqual(validateTimeline(entries), []);
    const evening = entries.find(e => e.presentation?.kind === 'handover' && e.presentation.profile === 'ln')!;
    const morning = entries.find(e => e.presentation?.kind === 'handover' && e.presentation.profile === 'lkp')!;
    assert.equal(evening.startsAtMs, ms('2026-10-23T20:00:00')); assert.equal(morning.startsAtMs, ms('2026-10-24T06:00:00'));
    assert.ok(entries.every(e => e.endsAtMs <= profileWindow(e.startsAtMs, f.app.station!).endsAtMs));
    assert.ok(entries.filter(e => e.presentation?.profile === 'ln').every(e => !e.playoutPlan?.segments.some(s => s.type === 'ad')));
    const bulletin = entries.filter(e => e.presentation?.block === 'aktuell' && e.presentation.kind === 'programme');
    assert.equal(bulletin.length, 1); assert.match(bulletin[0]!.description, /Originalveröffentlichung: 2026-09-02/);
    assert.ok(bulletin[0]!.startsAtMs >= ms('2026-10-23T20:05:00') && bulletin[0]!.startsAtMs <= ms('2026-10-23T20:15:00'));
    const restarted = buildScheduleEntries(f.db.listMedia(), 'night-restart', ms('2026-10-24T02:30:00'), ms('2026-10-24T06:00:01'), 0, [], schedulePlanning(f.db, f.app));
    const recoveredBulletins = restarted.filter(e => e.presentation?.block === 'aktuell' && e.presentation.kind === 'programme');
    assert.equal(recoveredBulletins.length, 1, 'a guarded rebuild after the preferred news block must still carry tonight’s latest bulletin');
    assert.ok(recoveredBulletins[0]!.startsAtMs >= ms('2026-10-24T02:30:00'));
    const rotation = entries.filter(e => e.showId === 'unusual').map(e => e.mediaId);
    for (let i = 0; i + 3 <= rotation.length; i += 3) assert.equal(new Set(rotation.slice(i, i + 3)).size, 3);
    assert.ok(entries.filter(e => e.startsAtMs >= ms('2026-10-24T02:00:00') && e.endsAtMs <= morning.startsAtMs && e.presentation?.kind === 'programme')
      .every(e => e.showId === 'regional'));
    f.db.insertSchedule(entries);
    const reread = f.db.currentAt(evening.startsAtMs)!; assert.deepEqual(reread.presentation, evening.presentation);
    const xml = generateEpgXml(entries, f.app); const file = path.join(f.root, 'epg.xml'); fs.writeFileSync(file, xml);
    if (spawnSync('tstabcomp', ['--version'], { stdio: 'ignore' }).status === 0) {
      execFileSync('tstabcomp', [file, '-o', path.join(f.root, 'epg.bin')], { stdio: 'pipe' });
    } else {
      t.diagnostic('TSDuck is unavailable; XML assertions run without binary compilation');
    }
    assert.match(xml, /content_descriptor/); assert.match(xml, /Lundenburg Nacht/);
  } finally { f.close(); }
});

test('LN uses its static live mark and full-screen idents suppress the live logo', () => {
  const f = fixture();
  try {
    f.app.station!.profiles.ln.logo = path.join(project, 'assets/logo/ln-logo.svg');
    const logo = prepareLogo({ ...f.app, logo: { ...f.app.logo, path: f.app.station!.profiles.ln.logo } });
    const media = item('adult', 1), start = ms('2026-10-23T21:00:00');
    const entry = { id: 'test', sequence: 0, mediaId: media.id, showId: media.showId, showTitle: 'Test', episodeTitle: 'Test', description: 'Test',
      startsAtMs: start, endsAtMs: start + 10000, durationMs: 10000, mediaPath: media.mediaPath, subtitleLanguages: [], presentation: { profile: 'ln' as const, kind: 'programme' as const } };
    const programme = buildFfmpegArgs(entry, media, 0, 10000, true, f.app, logo).join(' ');
    assert.ok(programme.includes(logo.path)); assert.ok(!programme.includes('rotate=angle'));
    const ident = buildFfmpegArgs({ ...entry, presentation: { profile: 'ln', kind: 'handover' } }, undefined, 0, 10000, true, f.app, logo).join(' ');
    assert.ok(!ident.includes(logo.path));
  } finally { f.close(); }
});

test('numbered meme and municipal title matching excludes unrelated uploads', () => {
  assert.equal(unusualEpisode('UNUSUAL MEMES COMPILATION V200'), 200);
  assert.equal(unusualEpisode('Unusual Memes Compilation - V. 002'), 2);
  for (const title of ['UNUSUAL MEMES COMPILATION', 'UNUSUAL MEMES COMPILATION V20 REACTION', 'A different compilation V20']) assert.equal(unusualEpisode(title), undefined);
  for (const title of ['Břeclavská televize', 'BŘECLAVSKÁ TELEVIZE – 17. 10. 2026', 'Breclavska televize vydání 8']) assert.equal(breclavBulletin(title), true);
  for (const title of ['Břeclavský koncert', 'Pozvánka: Břeclavská televize', 'Břeclavská televize koncert']) assert.equal(breclavBulletin(title), false);
  assert.equal(regionalRelevance('Universum: Leben in den March-Thaya-Auen'), 100);
  assert.equal(regionalRelevance('Landleben in der Wachau'), 50); assert.equal(regionalRelevance('Tiroler Gipfel'), 0);
});

test('numbered inventory backfill leaves metadata and model budgets available for ambiguous sources', async () => {
  const f = fixture();
  try {
    const sub = loadAcquisitionConfig({ ...f.app, projectRoot: project }).subscriptions.find(s => s.id === 'unusualvideos')!;
    sub.channelId = 'UC' + 'a'.repeat(22);
    f.app.station!.classifier.maxRequestsPerRun = 1;
    const store = new AcquisitionStore(f.db);
    for (let episode = 1; episode <= 12; episode++) store.remember({ source: 'youtube', sourceId: `fixture-${episode}`,
      sourceUrl: `https://www.youtube.com/watch?v=fixture-${episode}`, channelId: sub.channelId, showId: sub.id,
      title: `UNUSUAL MEMES COMPILATION V${episode}`, language: 'en', description: '', descriptionLanguage: 'en',
      durationMs: 600000, size: 1000, broadcaster: sub.title, components: [], compilation: true, format: 'episode', available: true });
    const accepted = await classifyNachtPending({ app: f.app, store, subscriptions: [sub], check: () => {}, deadline: Date.now() + 60000 },
      { decide: async () => assert.fail('Deterministic titles must not call a model') });
    assert.equal(accepted, 12);
    assert.ok(store.candidates().every(row => row.metadata.broadcastPolicy?.profiles.join() === 'ln'));
    assert.deepEqual(store.candidates().map(row => row.metadata.episode).sort((a, b) => a! - b!), Array.from({ length: 12 }, (_, n) => n + 1));
    assert.equal((f.db.db.prepare("SELECT count(*) count FROM acquisition_state WHERE key LIKE 'nacht-metadata:%'").get() as { count: number }).count, 0);
  } finally { f.close(); }
});

test('LN classifications cache by version and metadata, validate strictly, and honour manual overrides', async () => {
  const f = fixture();
  try {
    const sub = loadAcquisitionConfig({ ...f.app, projectRoot: project }).subscriptions.find(s => s.id === 'kraut')!;
    const c: Candidate = { source: 'youtube', sourceId: 'abcdefghijk', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk', showId: sub.id,
      title: 'A historical essay', language: 'en', description: 'History and economics', descriptionLanguage: 'en', durationMs: 800000, size: 1234,
      broadcaster: 'Kraut', components: [], compilation: false, format: 'episode', available: true };
    const result: NachtClassification = { eligible: true, standalone: true, category: 'history', timeOfNight: 'late', intensity: 'moderate', topics: ['Geschichte'], evergreen: true,
      series: 'Example', episode: 1, recommendedAge: 12, confidence: .6, reason: 'Limited metadata', descriptionDe: 'Ein historischer Videoessay.' };
    let calls = 0; const provider = { decide: async () => { calls++; return result; } };
    const classifier = new NachtClassifier(f.db.db);
    assert.equal((await classifier.classify(c, sub, provider, () => true)).confidence, .6);
    await classifier.classify(c, sub, provider, () => false); assert.equal(calls, 1);
    await classifier.classify({ ...c, description: 'Improved reliable source metadata' }, sub, provider, () => true); assert.equal(calls, 2);
    classifier.override(c, { ...result, confidence: 1 }); assert.equal((await classifier.classify(c, sub, provider, () => false)).confidence, 1);
    assert.throws(() => validateNachtClassification({ ...result, extra: true }));
    assert.throws(() => validateNachtClassification({ ...result, eligible: true, standalone: false }));
    const unusual = { ...sub, deterministicSeries: 'unusual' as const };
    assert.equal(deterministicNacht({ ...c, title: 'UNUSUAL MEMES COMPILATION V5' }, unusual)?.episode, 5);
  } finally { f.close(); }
});

test('YouTube inventory pins canonical IDs and refuses a different channel on subsequent scans', async () => {
  const f = fixture();
  try {
    const sub = loadAcquisitionConfig({ ...f.app, projectRoot: project }).subscriptions.find(s => s.id === 'unusualvideos')!;
    const data = { channel_id: 'UC' + 'a'.repeat(22), entries: [{ id: 'abcdefghijk', title: 'UNUSUAL MEMES COMPILATION V1', duration: 100 }] };
    const found = await discoverYoutube(sub, 1, 'fixture', async () => JSON.stringify(data), () => {});
    assert.equal(sub.channelId, data.channel_id); assert.equal(found[0]!.channelId, data.channel_id);
    await assert.rejects(discoverYoutube(sub, 1, 'fixture', async () => JSON.stringify({ ...data, channel_id: 'UC' + 'b'.repeat(22) }), () => {}));
  } finally { f.close(); }
});

test('latest-only replacement keeps a scheduled old file until the replacement is committed and the old reference clears', () => {
  const f = fixture();
  try {
    const store = new AcquisitionStore(f.db), subscriptions = loadAcquisitionConfig({ ...f.app, projectRoot: project }).subscriptions;
    const storage = new NachtStorage(f.app, store, subscriptions);
    const make = (n: number) => {
      const m = { ...item('breclav-tv', n), broadcast: policy('news', 'latest-only') };
      const dir = path.join(f.app.media.root, m.showId, 'acquired', `candidate-${n}`); fs.mkdirSync(dir, { recursive: true });
      m.mediaPath = path.join(dir, 'episode.mp4'); fs.writeFileSync(m.mediaPath, Buffer.alloc(100)); f.db.upsertMedia([m]); return m;
    };
    const old = make(1), c = { publishedAt: 1 } as Candidate;
    storage.registerLatest(old, c);
    const next = make(2);
    f.db.insertSchedule([{ id: 'committed', sequence: 0, mediaId: old.id, showId: old.showId, showTitle: 'News', episodeTitle: 'News', description: 'News',
      startsAtMs: Date.now() + 3600000, endsAtMs: Date.now() + 3610000, durationMs: 10000, mediaPath: old.mediaPath, subtitleLanguages: [] }]);
    f.db.db.transaction(() => storage.registerLatest(next, { ...c, publishedAt: 2 }))();
    assert.equal(f.db.listMedia().length, 1); assert.equal(f.db.listMedia()[0]!.id, next.id);
    assert.equal(storage.cleanup(), 0); assert.ok(fs.existsSync(old.mediaPath));
    f.db.clearSchedule(); assert.equal(storage.cleanup(), 1); assert.ok(!fs.existsSync(old.mediaPath)); assert.ok(fs.existsSync(next.mediaPath));
    const report = storage.report(); assert.equal(report.bytes >= 100, true);
    assert.throws(() => storage.assertAdmission(report.maxBytes));
  } finally { f.close(); }
});

test('playback rotation progress survives schedule replacement and duplicate completion calls', () => {
  const f = fixture();
  try {
    const m = item('adult', 1); f.db.upsertMedia([m]);
    f.db.insertSchedule([{ id: 'event', sequence: 0, mediaId: m.id, showId: m.showId, showTitle: 'Show', episodeTitle: 'Episode', description: 'Description', startsAtMs: 10, endsAtMs: 10010,
      durationMs: 10000, mediaPath: m.mediaPath, subtitleLanguages: [], presentation: { profile: 'ln', kind: 'programme' } }]);
    f.db.startPlayback({ id: 'play', scheduleEntryId: 'event', plannedStartMs: 10, plannedEndMs: 10010, actualStartMs: 10, initialSeekMs: 0, coldStartResume: false, status: 'started' });
    f.db.clearSchedule(); f.db.finishPlayback('play', 'completed'); f.db.finishPlayback('play', 'completed');
    assert.equal(schedulePlanning(f.db, f.app).history!.find(h => h.mediaId === m.id)!.count, 1);
  } finally { f.close(); }
});

test('runtime guard rejects adult media in a stale daytime schedule and programmes crossing handover', () => {
  const f = fixture();
  try {
    const adult = { ...item('adult', 1), broadcast: policy() }, at = ms('2026-10-24T06:00:00');
    const e = { id: 'stale', sequence: 0, mediaId: adult.id, showId: adult.showId, showTitle: 'Adult', episodeTitle: 'Adult', description: 'Adult',
      startsAtMs: at, endsAtMs: at + 10000, durationMs: 10000, mediaPath: adult.mediaPath, subtitleLanguages: [] };
    assert.equal(channelEntryAllowed(e, adult, f.app.station!, at), false);
    const night = ms('2026-10-24T05:59:00');
    assert.equal(channelEntryAllowed({ ...e, startsAtMs: night, endsAtMs: at + 10000 }, adult, f.app.station!, night), false);
    assert.equal(channelEntryAllowed({ ...e, startsAtMs: night, endsAtMs: at }, adult, f.app.station!, night), true);
    const assetPath = path.join(f.root, 'presentation.mp4');
    const fakeNightGap = { ...e, mediaId: 'station-continuity', showId: 'station-lkp', mediaPath: assetPath,
      presentation: { profile: 'lkp' as const, kind: 'gap' as const, loop: true } };
    const dayGap = { ...fakeNightGap, mediaId: 'station-day-continuity' };
    assert.equal(channelEntryAllowed(fakeNightGap, undefined, f.app.station!, at), false, 'a mislabeled asset cannot bypass the profile guard');
    assert.equal(channelEntryAllowed(dayGap, undefined, f.app.station!, at), true, 'only the manifest-approved daytime loop is allowed');
  } finally { f.close(); }
});


test('handover padding policy preserves the films, starts news without a logo wait, and uses an intact short before dawn',()=>{
  const f=fixture();try {
    f.app.station!.avoidHandoverLogoPadding=true;
    const news={...item('news',1,9*60_000),broadcast:policy('news','latest-only')};
    const evening=buildScheduleEntries([news,item('kids',1)],'no-padding',ms('2026-10-23T20:00:00'),ms('2026-10-23T20:09:18'),0,[],schedulePlanning(f.db,f.app));
    assert.equal(evening[0]!.presentation?.kind,'handover');assert.equal(evening[0]!.durationMs,10_000);
    assert.ok(evening.every(e=>e.presentation?.kind!=='gap'));
    assert.equal(evening.find(e=>e.mediaId===news.id)!.startsAtMs,ms('2026-10-23T20:00:14'));
    const short={...item('independent-short',1,10*60_000-12_000),broadcast:policy('comedy')};
    const dawn=buildScheduleEntries([short,item('kids',1)],'no-padding',ms('2026-10-24T05:50:00'),ms('2026-10-24T06:00:01'),0,[],schedulePlanning(f.db,f.app));
    assert.ok(dawn.every(e=>e.presentation?.kind!=='gap' && !e.presentation?.loop));
    assert.equal(dawn.find(e=>e.mediaId===short.id)!.durationMs,short.durationMs);
    const morning=dawn.find(e=>e.presentation?.kind==='handover')!;
    assert.equal(morning.startsAtMs,ms('2026-10-24T06:00:00'));assert.equal(morning.durationMs,10_000);
    assert.deepEqual(validateTimeline(dawn),[]);
  }finally{f.close();}
});


test('handover tail fitting can choose four distinct whole shorts when fewer cannot fit',()=>{
  const pool=[9,10,11,12].map((duration,i)=>item('short',i+1,duration*1000));
  const plan=fitNightTail(pool,42_000,0,m=>m.durationMs)!;
  assert.equal(plan.length,4);assert.equal(new Set(plan.map(m=>m.id)).size,4);
  assert.equal(plan.reduce((sum,m)=>sum+m.durationMs,0),42_000);
  assert.equal(fitNightTail(pool,43_000,0,m=>m.durationMs),undefined);
});
