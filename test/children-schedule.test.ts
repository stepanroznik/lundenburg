import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { parse } from 'yaml';
import { config, item } from './helpers.js';
import { ageEligible, childrenPolicy, loadChildrenConfig } from '../src/children-policy.js';
import { buildChildrenSchedule, programmeParts } from '../src/children-schedule.js';
import { buildScheduleEntries, schedulePlanning, setChildrenAge, validateTimeline } from '../src/schedule.js';
import { childrenSettings } from '../src/children-settings.js';
import { channelEntryAllowed, loadStationConfig, profileWindow } from '../src/channels.js';
import { LkpDatabase } from '../src/database.js';
import { generateEpgXml } from '../src/epg.js';
import { locatePlayoutPosition } from '../src/editorial.js';

const ms=(s:string)=>DateTime.fromISO(s,{zone:'Europe/Prague'}).toMillis();
function fixture(age=3) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lkp-ages-')),app=config(root);
  app.children=loadChildrenConfig(path.resolve('.'))!;app.children.targetAgeYears=age;
  app.station=loadStationConfig(path.resolve('.'))!;app.station.enabled=true;
  const video=path.join(root,'continuity.mp4');fs.writeFileSync(video,'fixture');
  app.station.assetManifest=path.join(root,'assets.json');
  const assets=['morning','evening','ident','outro','continuity','day-continuity'].map(id=>({id,path:video,durationMs:5000,fullScreen:true,destination:'lkp'}));
  fs.writeFileSync(app.station.assetManifest,JSON.stringify({version:1,status:'ready',fps:30,assets}));
  const shows=['bluey','bobo-siebenschlaefer','kikaninchen','teletubbies','miss-josi','ms-rachel','sendung-mit-dem-elefanten','byl-jednou-jeden-zivot','unser-sandmaennchen','tom-und-jerry','der-kleine-maulwurf'];
  const media=shows.flatMap(id=>Array.from({length:12},(_,i)=>{
    const m=item(id,i+1,(id==='bluey'?7:id==='ms-rachel'?23:id==='miss-josi'?12:id==='byl-jednou-jeden-zivot'?25:id==='sendung-mit-dem-elefanten'?25:5)*60_000);
    m.mediaPath=path.join(root,`${m.id}.mp4`);fs.writeFileSync(m.mediaPath,'fixture');return m;
  }));
  const db=new LkpDatabase(app.storage.database);db.upsertMedia(media);
  return {root,app,media,db,close:()=>{db.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test('all configured acquisition shows and shared library shows have explicit editorial age policies',()=>{
  const c=loadChildrenConfig(path.resolve('.'))!;
  for(const file of ['config/content-acquisition.yaml','config/acquisition-sources.yaml']) {
    const data=parse(fs.readFileSync(file,'utf8'));
    for(const show of data.subscriptions) assert.ok(c.policies[show.id],show.id);
  }
  for(const id of ['the-man-from-earth','breclav-tv','unsere-heimat','unusualvideos','wreck-it-ralph']) assert.ok(c.policies[id]);
});
test('age tolerance applies exactly once, ceilings exclude toddler shows after five, unknown fails closed',()=>{
  const c=loadChildrenConfig(path.resolve('.'))!;
  assert.ok(ageEligible(item('tom-und-jerry',1),c));
  assert.ok(!ageEligible(item('byl-jednou-jeden-zivot',1),c));
  c.targetAgeYears=6;
  assert.ok(ageEligible(item('byl-jednou-jeden-zivot',1),c));
  assert.ok(!ageEligible(item('ms-rachel',1),c));assert.ok(!ageEligible(item('miss-josi',1),c));
  assert.ok(!ageEligible(item('unknown',1),c));
  const override=item('bluey',1);override.technical.childrenPolicy={...c.policies.bluey!,recommendedAgeMin:8,recommendedAgeMax:10};
  assert.ok(!ageEligible(override,c));c.targetAgeYears=7;assert.ok(ageEligible(override,c));
  const classified=item('new-show',1);classified.technical.acquisition={classification:{ageSuitability:'preschool'}};
  assert.equal(childrenPolicy(classified,c)?.recommendedAgeMin,3);
});
test('fixed anchors, whole short episodes, day-ahead source identity and deterministic gap-free EPG',()=>{
  const f=fixture();try {
    const start=ms('2026-10-26T06:00'),end=ms('2026-10-28T06:00');
    const rows=buildScheduleEntries(f.media,'test',start,end,0,[],schedulePlanning(f.db,f.app));
    assert.deepEqual(validateTimeline(rows),[]);
    for(const slot of f.app.children!.slots.filter(s=>!s.rerunOf)) {
      const e=rows.find(e=>e.startsAtMs===ms(`2026-10-26T${slot.time}`));assert.ok(e,slot.time);
    }
    const bluey=rows.find(e=>e.startsAtMs===ms('2026-10-26T09:30'))!;
    assert.equal(bluey.showId,'bluey');assert.equal(bluey.playoutPlan!.assembly!.sources.length,4);
    assert.equal(new Set(bluey.playoutPlan!.assembly!.sources.map(s=>s.mediaId)).size,4);
    const repeat=rows.find(e=>e.startsAtMs===ms('2026-10-27T13:00'))!;
    assert.equal(repeat.playoutPlan!.assembly!.rerunOf,bluey.id);
    assert.deepEqual(repeat.playoutPlan!.segments,bluey.playoutPlan!.segments);
    assert.deepEqual(rows,buildScheduleEntries(f.media,'test',start,end,0,[],schedulePlanning(f.db,f.app)));
    f.db.insertSchedule(rows);
    const saved=f.db.currentAt(bluey.startsAtMs)!;
    assert.deepEqual(saved.playoutPlan,bluey.playoutPlan);
    assert.equal(locatePlayoutPosition(saved.playoutPlan!,8*60_000)?.segmentIndex,1);
    assert.match(generateEpgXml(f.db.listSchedule(start,end),f.app),/bluey/i);
  }finally{f.close();}
});
test('age six chooses older flagship, excludes both toddler teachers and tolerates missing assets',()=>{
  const f=fixture(6);try{
    fs.unlinkSync(f.media.find(m=>m.showId==='bluey')!.mediaPath);
    const rows=buildChildrenSchedule(f.media,'age6',ms('2026-10-26T06:00'),ms('2026-10-26T20:00'),0,[],f.app);
    assert.deepEqual(validateTimeline(rows),[]);
    assert.equal(rows.find(e=>e.startsAtMs===ms('2026-10-26T17:00'))!.showId,'byl-jednou-jeden-zivot');
    assert.ok(rows.every(e=>!['miss-josi','ms-rachel'].includes(e.showId)));
    assert.ok(rows.flatMap(e=>e.playoutPlan?.assembly?.sources ?? []).every(s=>s.mediaId!==f.media.find(m=>m.showId==='bluey')!.id));
  }finally{f.close();}
});
test('chapter-only segmentation preserves all content and persistent multipart sequence',()=>{
  const f=fixture();try {
    const long={...f.media.find(m=>m.showId==='ms-rachel')!,durationMs:90*60_000,editorialMarkers:[30,60].map(n=>({kind:'chapter' as const,startMs:n*60_000,source:'embedded' as const,confidence:.8}))};
    assert.equal(programmeParts(long,30*60_000).length,3);
    assert.equal(programmeParts({...long,editorialMarkers:[]},30*60_000).length,0);
    const rows=buildChildrenSchedule([long],'parts',ms('2026-10-26T08:30'),ms('2026-10-26T09:30'),0,[],f.app);
    const next=buildChildrenSchedule([long],'parts',ms('2026-10-27T08:30'),ms('2026-10-27T09:30'),rows.length,rows,f.app);
    assert.equal(rows[0]!.playoutPlan!.assembly!.sources[0]!.fromMs,0);
    assert.equal(next[0]!.playoutPlan!.assembly!.sources[0]!.fromMs,60*60_000);
  }finally{f.close();}
});
test('insufficient library uses validated continuity and never bypasses age',()=>{
  const f=fixture();try{
    const rows=buildChildrenSchedule([],'empty',ms('2026-10-26T06:00'),ms('2026-10-26T20:00'),0,[],f.app);
    assert.deepEqual(validateTimeline(rows),[]);assert.ok(rows.every(e=>e.showId==='station-lkp'));
  }finally{f.close();}
});
test('atomic age regeneration preserves current, history, Nacht identities and rolls back failure',()=>{
  const f=fixture();try{
    const start=ms('2026-10-26T06:00'),end=ms('2026-10-28T06:00');
    const rows=buildScheduleEntries(f.media,'test',start,end,0,[],schedulePlanning(f.db,f.app));f.db.insertSchedule(rows);
    const night=f.db.listSchedule(start,end).filter(e=>e.presentation?.profile==='ln');
    const before=f.db.currentAt(ms('2026-10-26T08:35'))!;
    const result=setChildrenAge(f.db,f.app,6,1,ms('2026-10-26T08:35'));
    assert.deepEqual(f.db.currentAt(before.startsAtMs),before);
    assert.ok(result.startMs>=before.endsAtMs);
    assert.deepEqual(f.db.listSchedule(start,end).filter(e=>e.presentation?.profile==='ln').map(({sequence,...e})=>e),night.map(({sequence,...e})=>e));
    const reopened=config(f.root);reopened.children=loadChildrenConfig(path.resolve('.'))!;childrenSettings(f.db,reopened);
    assert.equal(reopened.children!.targetAgeYears,6);
    const snapshot=f.db.listSchedule(start,end);assert.deepEqual(validateTimeline(snapshot),[]);
    fs.unlinkSync(f.app.station!.assetManifest);
    assert.throws(()=>setChildrenAge(f.db,f.app,3,1,ms('2026-10-27T07:00')));
    assert.deepEqual(f.db.listSchedule(start,end),snapshot);
    assert.equal(f.db.db.prepare('SELECT target_age FROM children_settings').pluck().get(),6);
  }finally{f.close();}
});
test('weekday/weekend barriers and both DST transitions stay gap-free',()=>{
  const f=fixture();try{
    for(const date of ['2026-03-28','2026-10-24','2026-10-26']) {
      const start=ms(`${date}T06:00`),end=DateTime.fromMillis(start,{zone:'Europe/Prague'}).plus({days:1}).toMillis();
      const rows=buildScheduleEntries(f.media,'dst',start,end,0,[],schedulePlanning(f.db,f.app));
      assert.deepEqual(validateTimeline(rows),[]);
      assert.ok(rows.every(e=>e.endsAtMs<=profileWindow(e.startsAtMs,f.app.station!).endsAtMs));
      const evening=rows.find(e=>e.presentation?.profile==='ln');
      assert.equal(DateTime.fromMillis(evening!.startsAtMs,{zone:'Europe/Prague'}).hour,date==='2026-10-26'?20:21);
    }
  }finally{f.close();}
});
test('runtime age guard rejects stale assemblies and checks every source',()=>{
  const f=fixture();try{
    const rows=buildChildrenSchedule(f.media,'guard',ms('2026-10-26T08:00'),ms('2026-10-26T08:30'),0,[],f.app);
    const e=rows[0]!,m=f.media.find(m=>m.id===e.mediaId)!;
    const catalogue=new Map(f.media.map(m=>[m.id,m]));
    assert.ok(channelEntryAllowed(e,m,f.app.station!,e.startsAtMs,f.app.children,catalogue));
    f.app.children!.targetAgeYears=6;
    assert.ok(!channelEntryAllowed(e,m,f.app.station!,e.startsAtMs,f.app.children,catalogue));
    f.app.children!.effectiveAtMs=e.endsAtMs;
    assert.ok(channelEntryAllowed(e,m,f.app.station!,e.startsAtMs,f.app.children,catalogue));
  }finally{f.close();}
});

test('weather replaces only a reserved gap, preserving fixed clocks and every subsequent EPG identity',async()=>{
  const {publishWeather}=await import('../src/weather/publish.js');
  const f=fixture();try{
    const from=ms('2099-10-26T06:00'),until=ms('2099-10-28T06:00');
    f.db.insertSchedule(buildScheduleEntries(f.media,'weather',from,until,0,[],schedulePlanning(f.db,f.app)));
    const old=f.db.listSchedule(from,until),window=old.find(e=>e.presentation?.block==='weather')!;
    const subtitles=path.join(f.root,'weather.srt');fs.writeFileSync(subtitles,'');
    const entry=publishWeather({id:'weather-test',title:'Test weather',edition:'morning',generatedAt:new Date(from).toISOString(),validFrom:new Date(from).toISOString(),validUntil:new Date(ms('2099-10-26T12:00')).toISOString(),durationMs:90_000,mediaPath:f.media[0]!.mediaPath,subtitlePath:subtitles,preview:false},f.db,f.app,from);
    assert.equal(entry.startsAtMs,window.startsAtMs);
    assert.deepEqual(validateTimeline(f.db.listSchedule(from,until)),[]);
    assert.deepEqual(f.db.listSchedule(window.endsAtMs,until).map(({sequence,...e})=>e),old.filter(e=>e.startsAtMs>=window.endsAtMs).map(({sequence,...e})=>e));
    assert.throws(()=>publishWeather({id:'too-long',title:'Too long',edition:'morning',generatedAt:new Date(from).toISOString(),validFrom:new Date(from).toISOString(),validUntil:new Date(ms('2099-10-26T12:00')).toISOString(),durationMs:6*60_000,mediaPath:f.media[0]!.mediaPath,subtitlePath:subtitles,preview:false},f.db,f.app,from));
  }finally{f.close();}
});
test('completed assemblies account for every source once and retain source history after a restart',()=>{
  const f=fixture();try{
    const rows=buildChildrenSchedule(f.media,'history',ms('2026-10-26T09:30'),ms('2026-10-26T10:00'),0,[],f.app);
    f.db.insertSchedule(rows);const e=rows[0]!;
    f.db.startPlayback({id:'assembly-play',scheduleEntryId:e.id,plannedStartMs:e.startsAtMs,plannedEndMs:e.endsAtMs,actualStartMs:e.startsAtMs,initialSeekMs:0,coldStartResume:false,status:'started'});
    f.db.finishPlayback('assembly-play','completed');f.db.finishPlayback('assembly-play','completed');
    const history=f.db.db.prepare('SELECT * FROM media_rotation_history').all() as {played_count:number}[];
    assert.equal(history.length,e.playoutPlan!.assembly!.sources.length);assert.ok(history.every(r=>r.played_count===1));
  }finally{f.close();}
});
test('weekend films stay intact and repeat the exact Saturday block on Sunday',()=>{
  const f=fixture(6);try{
    const film={...f.media[0]!,id:'film',showId:'wreck-it-ralph',durationMs:101*60_000,technical:{catalogue:{version:1,kind:'movie'}}};
    const saturday=buildChildrenSchedule([...f.media,film],'film',ms('2026-10-24T19:00'),ms('2026-10-24T21:00'),0,[],f.app);
    assert.equal(saturday[0]!.mediaId,'film');assert.equal(saturday[0]!.durationMs,film.durationMs);
    const sunday=buildChildrenSchedule([...f.media,film],'film',ms('2026-10-25T19:00'),ms('2026-10-25T21:00'),saturday.length,saturday,f.app);
    assert.deepEqual(sunday[0]!.playoutPlan!.segments,saturday[0]!.playoutPlan!.segments);
    assert.equal(sunday[0]!.playoutPlan!.assembly!.rerunOf,saturday[0]!.id);
  }finally{f.close();}
});
