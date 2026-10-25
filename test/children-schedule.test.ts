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
import type { ScheduleEntry } from '../src/types.js';
import { generateEpgXml } from '../src/epg.js';
import { locatePlayoutPosition } from '../src/editorial.js';

const ms=(s:string)=>DateTime.fromISO(s,{zone:'Europe/Prague'}).toMillis();
function fixture(age=3) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lkp-ages-')),app=config(root);
  app.children=loadChildrenConfig(path.resolve('.'))!;app.children.targetAgeYears=age;
  app.station=loadStationConfig(path.resolve('.'))!;app.station.enabled=true;app.station.avoidHandoverLogoPadding=false;
  const video=path.join(root,'continuity.mp4');fs.writeFileSync(video,'fixture');
  app.station.assetManifest=path.join(root,'assets.json');
  const assets=['morning','evening','ident','outro','continuity','day-continuity'].map(id=>({id,path:video,durationMs:5000,fullScreen:true,destination:'lkp'}));
  fs.writeFileSync(app.station.assetManifest,JSON.stringify({version:1,status:'ready',fps:30,assets}));
  const shows=['bluey','bobo-siebenschlaefer','kikaninchen','teletubbies','miss-josi','ms-rachel','sendung-mit-dem-elefanten','byl-jednou-jeden-zivot','unser-sandmaennchen','tom-und-jerry','der-kleine-maulwurf'];
  const media=shows.flatMap(id=>Array.from({length:12},(_,i)=>{
    const m=item(id,i+1,(id==='bluey'?7:id==='ms-rachel'?23:id==='miss-josi'?12:id==='byl-jednou-jeden-zivot'?25:id==='sendung-mit-dem-elefanten'?25:5)*60_000);
    m.mediaPath=path.join(root,`${m.id}.mp4`);fs.writeFileSync(m.mediaPath,'fixture');return m;
  }));
  for(let i=13;i<=30;i++) {
    const m=item('der-kleine-maulwurf',i,43_000);m.mediaPath=path.join(root,`${m.id}.mp4`);fs.writeFileSync(m.mediaPath,'fixture');media.push(m);
  }
  for(const [episode,durationMs] of [[31,30_000],[32,5_000]] as const) {
    const m=item('der-kleine-maulwurf',episode,durationMs);m.mediaPath=path.join(root,`${m.id}.mp4`);fs.writeFileSync(m.mediaPath,'fixture');media.push(m);
  }
  app.intermissions={enabled:true,manifest:path.join(root,'intermissions.json'),boundaryRate:.8,weights:{ident:70,silent:20,voiced:10}};
  fs.writeFileSync(app.intermissions.manifest,JSON.stringify({version:1,revision:'test',clips:[{id:'ident',title:'LKP ident',kind:'ident',mediaPath:video,durationMs:5000,languages:['zxx'],synopsis:'Station ident'},{id:'short',title:'Short film',kind:'silent',mediaPath:video,durationMs:11_000,languages:['zxx'],synopsis:'A short film'}]}));
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
const slotEntry=(rows:ScheduleEntry[],time:string,date='2026-10-26')=>rows.find(e=>e.playoutPlan?.assembly?.slot===time && DateTime.fromMillis(e.startsAtMs,{zone:'Europe/Prague'}).toISODate()===date)!;

test('soft anchors, whole short episodes, day-ahead source identity and deterministic gap-free EPG',()=>{
  const f=fixture();try {
    const start=ms('2026-10-26T06:00'),end=ms('2026-10-28T06:00');
    const rows=buildScheduleEntries(f.media,'test',start,end,0,[],schedulePlanning(f.db,f.app));
    assert.deepEqual(validateTimeline(rows),[]);
    for(const slot of f.app.children!.slots.filter(s=>!s.rerunOf)) {
      if(slot.weekdays && !slot.weekdays.includes(1))continue;
      const e=slotEntry(rows,slot.time);assert.ok(e,slot.time);assert.ok(Math.abs(e.startsAtMs-ms(`2026-10-26T${slot.time}`))<=5000,slot.time);
    }
    const bluey=slotEntry(rows,'09:30');
    assert.equal(bluey.showId,'bluey');assert.equal(bluey.playoutPlan!.assembly!.sources.length,4);
    assert.equal(new Set(bluey.playoutPlan!.assembly!.sources.map(s=>s.mediaId)).size,4);
    const repeat=slotEntry(rows,'13:00','2026-10-27');
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
    assert.equal(slotEntry(rows,'17:00').showId,'byl-jednou-jeden-zivot');
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
    const next=buildChildrenSchedule([long],'parts',ms('2026-10-27T08:30'),ms('2026-10-27T09:00'),rows.length,rows,f.app);
    assert.equal(rows[0]!.playoutPlan!.assembly!.sources[0]!.fromMs,0);
    assert.equal(next[0]!.playoutPlan!.assembly!.sources[0]!.fromMs,60*60_000);
  }finally{f.close();}
});
test('an empty age-eligible library refuses generation instead of scheduling holding screens',()=>{
  const f=fixture();try{
    assert.throws(()=>buildChildrenSchedule([],'empty',ms('2026-10-26T06:00'),ms('2026-10-26T20:00'),0,[],f.app),/No playable age-eligible/);
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
    fs.writeFileSync(f.app.intermissions!.manifest,'{}');
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

test('weather replaces normal content in its reserved window, preserving fixed clocks and every subsequent EPG identity',async()=>{
  const {publishWeather}=await import('../src/weather/publish.js');
  const f=fixture();try{
    const from=ms('2099-10-26T06:00'),until=ms('2099-10-28T06:00');
    f.db.insertSchedule(buildScheduleEntries(f.media,'weather',from,until,0,[],schedulePlanning(f.db,f.app)));
    const old=f.db.listSchedule(from,until),window=old.find(e=>e.presentation?.block==='weather')!;
    const following=old.filter(e=>e.startsAtMs>=window.startsAtMs);
    const windowEnd=following.slice(0,following.findIndex(e=>e.presentation?.block!=='weather')).at(-1)!.endsAtMs;
    const subtitles=path.join(f.root,'weather.srt');fs.writeFileSync(subtitles,'');
    const entry=publishWeather({id:'weather-test',title:'Test weather',edition:'morning',generatedAt:new Date(from).toISOString(),validFrom:new Date(from).toISOString(),validUntil:new Date(ms('2099-10-26T12:00')).toISOString(),durationMs:90_000,mediaPath:f.media[0]!.mediaPath,subtitlePath:subtitles,preview:false},f.db,f.app,from);
    assert.equal(entry.startsAtMs,window.startsAtMs);
    assert.deepEqual(validateTimeline(f.db.listSchedule(from,until)),[]);
    assert.deepEqual(f.db.listSchedule(windowEnd,until).map(({sequence,...e})=>e),old.filter(e=>e.startsAtMs>=windowEnd).map(({sequence,...e})=>e));
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

test('short programmes may finish a few seconds late and leave no scheduled pauses',()=>{
  const f=fixture();try{
    const bluey=f.media.filter(m=>m.showId==='bluey').map(m=>({...m,durationMs:7*60_000+1000}));
    const short=f.media.filter(m=>m.showId==='der-kleine-maulwurf').map(m=>({...m,durationMs:m.durationMs===5_000?5_000:30_000}));
    const rows=buildChildrenSchedule([...bluey,...short],'soft',ms('2026-10-26T09:30'),ms('2026-10-26T10:30'),0,[],f.app);
    assert.deepEqual(validateTimeline(rows),[]);
    assert.ok(rows.every(e=>e.presentation?.kind!=='gap' && !e.presentation?.loop && e.episodeTitle!=='Eine kleine Pause'));
    const next=slotEntry(rows,'10:00');
    assert.ok(Math.abs(next.startsAtMs-ms('2026-10-26T10:00'))<=5000);
    assert.ok(next.startsAtMs>ms('2026-10-26T10:00'),'whole shorts can finish after the nominal anchor');
    for(const e of rows) for(const source of e.playoutPlan?.assembly?.sources ?? []) {
      const original=[...bluey,...short].find(m=>m.id===source.mediaId)!;
      assert.equal(source.toMs-source.fromMs,original.durationMs);
    }
    assert.equal(rows.at(-1)!.endsAtMs,ms('2026-10-26T10:30'));
  }finally{f.close();}
});
test('approved ad fillers include WERBUNG and never admit unknown-age ads',()=>{
  const f=fixture();try{
    f.app.advertising={enabled:true,root:f.root,programmeInterval:2,minEditorialMinutes:16,targetSeconds:{min:30,max:60},searchWindowMinutes:2,minimumBreakpointScore:50,bumperManifest:path.join(f.root,'bumpers.json')};
    const media=f.media.filter(m=>m.showId==='bluey');
    const ad={id:'approved',title:'Approved family ad',sourceUrl:'https://example.test/ad',language:'de',durationMs:25_000,mediaPath:media[0]!.mediaPath,enabled:true,tags:[],ageSuitability:'all-ages',sourceMetadata:{}};
    const fillers={ads:[ad],clips:JSON.parse(fs.readFileSync(f.app.intermissions!.manifest,'utf8')).clips,bumpers:[{character:'sisi' as const,mediaPath:media[0]!.mediaPath,durationMs:5000}]};
    const rows=buildChildrenSchedule(media,'ads',ms('2026-10-26T09:30'),ms('2026-10-26T10:00'),0,[],f.app,fillers);
    const pod=rows.find(e=>e.showId==='lkp-advertising')!;assert.ok(pod);
    assert.equal(pod.playoutPlan!.segments[0]!.type,'ad-ident');
    assert.ok(channelEntryAllowed(pod,undefined,f.app.station!,pod.startsAtMs,f.app.children));
    fillers.ads=[{...ad,ageSuitability:'unknown'}];
    assert.throws(()=>buildChildrenSchedule(media,'ads',ms('2026-10-26T09:30'),ms('2026-10-26T10:00'),0,[],f.app,fillers),/No playable/);
  }finally{f.close();}
});

test('Christmas ad fillers are admitted only on December 1–25 and retain the calendar restriction',()=>{
  const f=fixture();try{
    f.app.advertising={enabled:true,root:f.root,programmeInterval:2,minEditorialMinutes:16,targetSeconds:{min:30,max:60},searchWindowMinutes:2,minimumBreakpointScore:50,bumperManifest:path.join(f.root,'bumpers.json')};
    const media=f.media.filter(m=>m.showId==='bluey');
    const ad={id:'christmas',title:'Christmas family ad',sourceUrl:'https://example.test/ad',language:'de',durationMs:25_000,mediaPath:media[0]!.mediaPath,enabled:true,tags:['christmas'],ageSuitability:'all-ages',sourceMetadata:{}};
    const fillers={ads:[ad],clips:JSON.parse(fs.readFileSync(f.app.intermissions!.manifest,'utf8')).clips,bumpers:[{character:'sisi' as const,mediaPath:media[0]!.mediaPath,durationMs:5000}]};
    for(const [date,expected] of [['2026-11-30',false],['2026-12-01',true],['2026-12-25',true],['2026-12-26',false]] as const) {
      if(!expected) {assert.throws(()=>buildChildrenSchedule(media,'ads',ms(`${date}T09:30`),ms(`${date}T10:00`),0,[],f.app,fillers),/No playable/);continue;}
      const rows=buildChildrenSchedule(media,'ads',ms(`${date}T09:30`),ms(`${date}T10:00`),0,[],f.app,fillers);
      const spots=rows.flatMap(e=>e.playoutPlan?.segments ?? []).filter(s=>s.type==='ad');
      assert.equal(spots.length>0,expected,date);
      for(const spot of spots) assert.deepEqual(spot.tags,['christmas']);
    }
  }finally{f.close();}
});

test('a pre-upgrade acquisition compiler cannot overwrite the active age-aware schedule',()=>{
  const f=fixture();try{
    const from=ms('2026-10-26T06:00'),end=ms('2026-10-28T06:00');
    f.db.insertSchedule(buildScheduleEntries(f.media,'fence',from,end,0,[],schedulePlanning(f.db,f.app)));
    setChildrenAge(f.db,f.app,3,1,ms('2026-10-26T07:00'));
    const old=f.db.listSchedule(from,end);
    const next=old.find(e=>e.startsAtMs>=ms('2026-10-27T07:00') && e.playoutPlan?.assembly?.sources.length)!;
    const {playoutPlan:_plan,...legacy}=next;
    assert.throws(()=>f.db.db.transaction(()=>{
      f.db.db.prepare('DELETE FROM schedule_entries WHERE sequence>=?').run(next.sequence);
      f.db.insertSchedule([legacy]);
    }).immediate(),/requires source assemblies/);
    assert.deepEqual(f.db.listSchedule(from,end),old);
  }finally{f.close();}
});


test('curated unlabelled ads form pods and intermissions never touch across compiler calls',()=>{
  const f=fixture();try {
    f.app.advertising={enabled:true,root:f.root,programmeInterval:2,minEditorialMinutes:16,targetSeconds:{min:30,max:60},searchWindowMinutes:2,minimumBreakpointScore:50,bumperManifest:path.join(f.root,'bumpers.json')};
    const media=f.media.filter(m=>m.showId==='bluey');
    const ads=[15_000,20_000,25_000].map((durationMs,i)=>({id:`ad-${i}`,title:`Curated ad ${i}`,sourceUrl:'https://example.test/ad',language:'de',durationMs,mediaPath:media[0]!.mediaPath,enabled:true,tags:[],sourceMetadata:{}}));
    const fillers={ads,clips:JSON.parse(fs.readFileSync(f.app.intermissions!.manifest,'utf8')).clips,bumpers:[{character:'sisi' as const,mediaPath:media[0]!.mediaPath,durationMs:5000}]};
    const from=ms('2026-10-26T09:30'),end=ms('2026-10-26T10:00');
    const rows=buildChildrenSchedule(media,'pods',from,end,0,[],f.app,fillers);
    assert.ok(rows.some(e=>e.playoutPlan!.segments.filter(s=>s.type==='ad').length>1));
    assert.deepEqual(validateTimeline(rows),[]);
    assert.ok(rows.every((e,i)=>e.showId!=='lkp-intermissions'||rows[i-1]?.showId!=='lkp-intermissions'));
    const tail=buildChildrenSchedule(media,'pods',end,end+60_000,rows.length,rows,f.app,fillers);
    assert.ok(tail.every((e,i)=>e.showId!=='lkp-intermissions'||(tail[i-1]??rows.at(-1))?.showId!=='lkp-intermissions'));
    f.db.insertSchedule(rows);childrenSettings(f.db,f.app);
    const previous=rows.find(e=>e.showId==='lkp-intermissions');
    if(previous)assert.throws(()=>f.db.insertSchedule([{...previous,id:'bad-neighbour',sequence:9999,startsAtMs:previous.endsAtMs,endsAtMs:previous.endsAtMs+previous.durationMs}]),/Consecutive LKP intermissions/);
  }finally{f.close();}
});

test('weather generation selects reserved windows, skipping ordinary programmes and Nacht',async()=>{
  const {weatherBoundary}=await import('../src/weather/boundary.js');
  const f=fixture();try {
    const from=ms('2099-10-26T06:00'),until=ms('2099-10-27T06:00');
    f.db.insertSchedule(buildScheduleEntries(f.media,'due-weather',from,until,0,[],schedulePlanning(f.db,f.app)));
    for(const time of ['06:05','15:00','18:30']) {
      const at=ms(`2099-10-26T${time}`);
      const found=weatherBoundary(f.db,f.app,at-5000,at+5*60_000,90_000)!;
      assert.ok(found,time);assert.equal(found.presentation?.block,'weather');assert.ok(Math.abs(found.startsAtMs-at)<=5000,time);
    }
    assert.equal(weatherBoundary(f.db,f.app,ms('2099-10-26T21:00'),until,90_000),undefined);
    assert.equal(weatherBoundary(f.db,f.app,ms('2099-10-26T15:00')-5000,ms('2099-10-26T15:05'),6*60_000),undefined);
  }finally{f.close();}
});


test('a tight hard handover keeps whole programmes and leaves room for real ads',()=>{
  const f=fixture();try {
    f.app.advertising={enabled:true,root:f.root,programmeInterval:2,minEditorialMinutes:16,targetSeconds:{min:30,max:60},searchWindowMinutes:2,minimumBreakpointScore:50,bumperManifest:path.join(f.root,'bumpers.json')};
    const media=f.media.filter(m=>m.showId==='bluey');
    const ads=[15_000,20_000,25_000].map((durationMs,i)=>({id:`hard-ad-${i}`,title:`Curated ad ${i}`,sourceUrl:'https://example.test/ad',language:'de',durationMs,mediaPath:media[0]!.mediaPath,enabled:true,tags:[],sourceMetadata:{}}));
    const fillers={ads,clips:JSON.parse(fs.readFileSync(f.app.intermissions!.manifest,'utf8')).clips,bumpers:[{character:'sisi' as const,mediaPath:media[0]!.mediaPath,durationMs:5000}]};
    for(const duration of [7*60_000+7_000,14*60_000+7_000,7*60_000+17_000]) {
      const start=ms('2026-10-26T07:30'),end=start+duration;
      const rows=buildChildrenSchedule(media,'tight-hard-tail',start,end,0,[],f.app,fillers);
      assert.equal(rows.at(-1)!.endsAtMs,end);assert.deepEqual(validateTimeline(rows),[]);
      assert.ok(rows.every((e,i)=>e.showId!=='lkp-intermissions'||rows[i-1]?.showId!=='lkp-intermissions'));
      assert.ok(rows.flatMap(e=>e.playoutPlan!.segments).filter(s=>s.type==='content').every(s=>s.durationMs===7*60_000));
    }
  }finally{f.close();}
});
