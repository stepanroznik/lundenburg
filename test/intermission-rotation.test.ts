import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildScheduleEntries, validateTimeline } from '../src/schedule.js';
import { planIntermissions, reconcileIntermissions, type RotationClip } from '../src/intermissions/rotation.js';
import { seasonAt } from '../src/intermissions/season.js';
import { buildFfmpegArgs } from '../src/playout.js';
import { LkpDatabase } from '../src/database.js';
import { config, item } from './helpers.js';
import type { IntermissionConfig } from '../src/types.js';

const policy:IntermissionConfig={enabled:true,manifest:'/unused.json',boundaryRate:.8,weights:{ident:70,silent:20,voiced:10}};
const clips:RotationClip[]=[{id:'ident',title:'Logo',kind:'ident',mediaPath:'/ident.mp4',durationMs:5000,languages:['de','cs'],synopsis:'Brand ident'},
  ...(['spring','summer','autumn','winter'] as const).flatMap(season=>[1,2].map(i=>({id:`${season}-${i}`,title:season,kind:'silent' as const,season,mediaPath:`/${season}-${i}.mp4`,durationMs:11000,languages:[],synopsis:'Silent'}))),
  ...[1,2,3,4,5,6].map(i=>({id:`voiced-${i}`,title:'Story',kind:'voiced' as const,mediaPath:`/voiced-${i}.mp4`,durationMs:22000,languages:['de'],synopsis:'Dialogue'}))];

test('rotation is deterministic, mostly ident, gapless, seasonal, and preserves every whole programme',()=>{
  const start=Date.parse('2026-08-31T15:00:00Z');
  const original=buildScheduleEntries([item('a',1,600000),item('b',1,600000)],'rotation',start,start+600000*1000);
  const plan=planIntermissions(original,clips,policy,'rotation',start);
  assert.deepEqual(plan,planIntermissions(original,clips,policy,'rotation',start));
  assert.ok(plan.inserted.length>740&&plan.inserted.length<860);
  const idents=plan.inserted.filter(e=>e.mediaId==='intermission-ident').length;
  assert.ok(idents/plan.inserted.length>.63&&idents/plan.inserted.length<.77);
  assert.deepEqual(validateTimeline(plan.entries),[]);
  const programmes=plan.entries.filter(e=>e.showId!=='lkp-intermissions');
  assert.deepEqual(programmes.map(e=>[e.id,e.durationMs,e.episode]),original.map(e=>[e.id,e.durationMs,e.episode]));
  for(const e of plan.inserted){const c=clips.find(c=>`intermission-${c.id}`===e.mediaId)!;assert.ok(!c.season||c.season===seasonAt(new Date(e.startsAtMs)));}
  assert.equal(planIntermissions(plan.entries,clips,policy,'rotation',start).inserted.length,0);
});
test('near/current boundaries and forecast expiry remain protected',()=>{
  const start=Date.now(),original=buildScheduleEntries([item('a',1,30000),item('b',1,30000)],'s',start,start+300000);
  const weather=original[5]!;weather.showId='lkp-weather';
  const plan=planIntermissions(original,clips,{...policy,boundaryRate:1},'s',start+60000,new Map([[weather.id,weather.endsAtMs+5000]]));
  assert.deepEqual(plan.entries.slice(0,2),original.slice(0,2));
  assert.ok(plan.entries.find(e=>e.id===weather.id)!.endsAtMs<=weather.endsAtMs+5000);
  assert.ok(plan.inserted.length>0);
  assert.deepEqual(validateTimeline(plan.entries),[]);
});
test('persistent insertion is idempotent and cold-start lookup finds the exact skit',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lkp-rotation-'));
  const db=new LkpDatabase(path.join(root,'test.sqlite'));
  try{
    const c=config(root),now=Date.now();
    const localClips=clips.map(clip=>{const mediaPath=path.join(root,path.basename(clip.mediaPath));fs.writeFileSync(mediaPath,'fixture');return {...clip,mediaPath};});
    const manifest=path.join(root,'published.json');fs.writeFileSync(manifest,JSON.stringify({version:1,revision:'test',clips:localClips}));
    c.intermissions={...policy,manifest,boundaryRate:1};
    const rows=buildScheduleEntries([item('a',1,120000),item('b',1,120000)],'s',now,now+120000*12);db.insertSchedule(rows);
    assert.equal(reconcileIntermissions(db,c,now),11);
    const after=db.listSchedule(now,now+10000000);
    assert.deepEqual(after[0],rows[0]);
    assert.equal(reconcileIntermissions(db,c,now),0);
    assert.deepEqual(db.listSchedule(now,now+10000000),after);
    const skit=after[1]!;assert.equal(skit.showId,'lkp-intermissions');
    assert.equal(db.currentAt(skit.startsAtMs+1000)?.id,skit.id);
    assert.equal(db.currentAt(skit.endsAtMs)?.id,after[2]!.id);
  }finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('intermissions play their own logo without an extra spinning corner overlay',()=>{
  const c=config('/tmp/lkp-test');
  const e=buildScheduleEntries([item('a',1)],'s',1000,5000)[0]!;
  e.showId='lkp-intermissions';
  const args=buildFfmpegArgs(e,undefined,0,e.durationMs,true,c,{path:'/corner.png',width:120,height:123});
  assert.ok(!args.includes('/corner.png'));
  const filter=args[args.indexOf('-filter_complex')+1]!;
  assert.ok(!filter.includes('overlay'));assert.ok(filter.endsWith('[v]'));
});
