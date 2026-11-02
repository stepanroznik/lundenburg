import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {DateTime} from 'luxon';
import {availableDuring} from '../src/programming/availability.js';
import {christmasSkits} from '../src/intermissions/christmas.js';
import {characters,presenters,presenter} from '../src/characters/registry.js';
import {eligibleSkits} from '../src/intermissions/model.js';
import {chooseIntermission,clipAvailableAt,intermissionPlan,readRotationLibrary,type RotationClip} from '../src/intermissions/rotation.js';
import {prepareFilm} from '../src/intermissions/prepare.js';
import {spokenNames} from '../src/weather/speech.js';
import {LkpDatabase} from '../src/database.js';
import {locatePlayoutPosition} from '../src/editorial.js';
import {generateEpgXml} from '../src/epg.js';
import {config,item} from './helpers.js';
import type {ScheduleEntry} from '../src/types.js';
const at=(s:string)=>DateTime.fromISO(s,{zone:'Europe/Prague'}).toMillis();
const clips:RotationClip[]=christmasSkits.map(s=>({id:s.id,title:s.title,kind:s.kind,availability:s.availability!,mediaPath:'/tmp/christmas-fixture.mp4',durationMs:(s.seconds??180)*1000,languages:s.kind==='silent'?['zxx']:['de','cs','sk'],synopsis:s.synopsis}));

test('Christmas availability recurs annually on every Prague December 1–25 date only',()=>{
  for(const year of [2026,2027,2028])for(let day=DateTime.local(year,1,1,{zone:'Europe/Prague'});day.year===year;day=day.plus({days:1})) {
    const expected=day.month===12&&day.day<=25;
    assert.equal(availableDuring('christmas',day.set({hour:12}).toMillis()),expected,day.toISODate()!);
    assert.equal(eligibleSkits(christmasSkits,day.set({hour:12}).toJSDate()).length,expected?4:0);
  }
  assert.equal(availableDuring('christmas',Date.parse('2026-11-30T23:00:00Z')),true);
  assert.equal(availableDuring('christmas',Date.parse('2026-11-30T22:59:59Z')),false);
  assert.equal(availableDuring('christmas',at('2026-12-25T23:59:40'),20_000),true);
  assert.equal(availableDuring('christmas',at('2026-12-25T23:59:40'),20_001),false);
  assert.equal(availableDuring('christmas',Date.parse('2026-12-25T23:00:00Z')),false);
});
test('Jeschischek is a Czech seasonal cast member; weather still has exactly four cities',()=>{
  assert.equal(characters.length,5);assert.equal(presenters.length,4);
  assert.equal(presenter('jeschischek').language,'cs');
  assert.equal(spokenNames('Jeschischek, Jeschischku!', 'cs'),'Ježíšek, Ježíšku!');
  for(const skit of christmasSkits)for(const line of skit.lines)assert.equal(line.language,presenter(line.speaker).language);
  assert.deepEqual(christmasSkits.map(s=>s.kind),['silent','silent','voiced','voiced']);
});
test('silent Christmas films use no speech/network even when paid mode is selected',async()=>{
  const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Unexpected paid request');};
  try{for(const s of christmasSkits.filter(s=>s.kind==='silent')){const f=await prepareFilm(s,'tts');assert.equal(f.preview,false);assert.equal(f.cues.length,0);}}finally{globalThis.fetch=fetch;}
});
test('normal rotation prefers Christmas within the same kind and never chooses it outside its dates',()=>{
  const m=item('bluey',1);const after={...m,id:'programme'} as unknown as ScheduleEntry;
  const policy={enabled:true,manifest:'',boundaryRate:1,weights:{ident:0,silent:1,voiced:0}};
  const regular={...clips[0]!,id:'ordinary'};delete regular.availability;
  const library=[regular,...clips];
  assert.ok(chooseIntermission(library,policy,'test',after,at('2026-12-03T12:00'))?.availability);
  assert.equal(chooseIntermission(library,policy,'test',after,at('2026-12-26T12:00'))?.id,'ordinary');
  assert.equal(clipAvailableAt(clips[0]!,at('2027-12-01T08:00')),true);
});
test('long voiced Christmas film publishes in the existing library and persistent restart seeks the saved event',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lkp-christmas-')),app=config(root),file=path.join(root,'film.mp4');fs.writeFileSync(file,'fixture');
  app.intermissions={enabled:true,manifest:path.join(root,'library.json'),boundaryRate:1,weights:{ident:1,silent:1,voiced:1}};
  const clip={...clips[3]!,mediaPath:file};
  fs.writeFileSync(app.intermissions.manifest,JSON.stringify({version:1,revision:'fixture',clips:[clip]}));
  assert.equal(readRotationLibrary(app)[0]!.durationMs,180_000);
  let db=new LkpDatabase(app.storage.database);
  try{
    const start=at('2026-12-03T15:19:00'),id='christmas-event';
    const event:ScheduleEntry={id,sequence:0,mediaId:`intermission-${clip.id}`,showId:'lkp-intermissions',showTitle:'LKP Weihnachten',episodeTitle:clip.title,description:clip.synopsis,mediaPath:file,startsAtMs:start,endsAtMs:start+clip.durationMs,durationMs:clip.durationMs,audioLanguage:'mul',subtitleLanguages:[],listingVisibility:'public',presentation:{profile:'lkp',kind:'programme',block:'christmas'},playoutPlan:intermissionPlan(clip,id)};
    db.insertSchedule([event]);db.close();db=new LkpDatabase(app.storage.database);
    const current=db.currentAt(start+43_000)!;assert.equal(current.id,id);assert.equal(current.startsAtMs,start);
    assert.equal(locatePlayoutPosition(current.playoutPlan!,43_000)?.offsetMs,43_000);
    assert.match(generateEpgXml([current],app),/Wer bringt die Weihnachtsgeschenke/);
    const segment=current.playoutPlan!.segments[0]!;assert.equal(segment.type,'intermission');
    if(segment.type==='intermission')assert.equal(segment.availability,'christmas');
  }finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
});
