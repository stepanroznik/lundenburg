import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LkpDatabase } from '../src/database.js';
import { AcquisitionStore } from '../src/acquisition/store.js';
import { installQualityReplacement, recoverQualityReplacement } from '../src/acquisition/quality-replacement.js';
import { Deferred, signature } from '../src/acquisition/io.js';
import type { ProbeResult } from '../src/media.js';
import { item } from './helpers.js';

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lkp-swap-')), episodeDir=path.join(root,'media/show/acquired/episode-id');
  const original=path.join(episodeDir,'episode.mp4'),dir=path.join(root,'media/.acquisition/staging/quality-episode-id'),prepared=path.join(dir,'playout.mp4');
  fs.mkdirSync(episodeDir,{recursive:true});fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(original,'old low resolution');fs.writeFileSync(prepared,'validated high resolution replacement');
  const db=new LkpDatabase(path.join(root,'catalogue.sqlite')),store=new AcquisitionStore(db);
  const asset={...item('show',1),mediaPath:original,technical:{acquisition:{sourceId:'abcdefghijk'},streams:[{height:360}],chapters:[{title:'keep'}]}};
  db.upsertMedia([asset]);store.file({path:original,...signature(original),show_id:'show',language:'en',keys_json:'["identity"]',catalogue_id:asset.id,state:'indexed',new_asset:1});
  fs.writeFileSync(path.join(episodeDir,'ingest.json'),JSON.stringify({item:asset,candidate:{sourceId:'abcdefghijk'},mediaSignature:signature(original)}));
  fs.writeFileSync(path.join(episodeDir,'episode.en.srt'),'unchanged captions');
  db.insertSchedule([{id:'scheduled',sequence:1,mediaId:asset.id,showId:'show',showTitle:'Show',episodeTitle:'Episode',description:'Keep',startsAtMs:100000,endsAtMs:110000,durationMs:10000,mediaPath:original,audioLanguage:'en',subtitleLanguages:['en']}]);
  const probe:ProbeResult={format:{duration:'10'},streams:[{index:0,codec_type:'video',codec_name:'h264',width:1920,height:1080},{index:1,codec_type:'audio',codec_name:'aac'}]};
  const options={db,original,prepared,dir,sourceId:'abcdefghijk',targetHeight:1080,probe,guard:()=>{}};
  return {...options,store,episodeDir,close:()=>{db.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test('quality swap retains one asset at the same path/ID and removes old/staged copies without changing the schedule',()=>{
 const f=fixture();try{
  const schedule=f.db.db.prepare('SELECT * FROM schedule_entries').all(),id=f.db.listMedia(false)[0]!.id;
  installQualityReplacement(f);
  assert.equal(fs.readFileSync(f.original,'utf8'),'validated high resolution replacement');
  assert.equal(fs.existsSync(f.dir),false);assert.equal(f.db.listMedia(false).length,1);assert.equal(f.db.listMedia(false)[0]!.id,id);
  assert.equal((f.db.db.prepare('SELECT count(*) n FROM media_assets').get() as {n:number}).n,1);
  assert.deepEqual(f.db.db.prepare('SELECT * FROM schedule_entries').all(),schedule);
  assert.equal(fs.readFileSync(path.join(f.episodeDir,'episode.en.srt'),'utf8'),'unchanged captions');
  const manifest=JSON.parse(fs.readFileSync(path.join(f.episodeDir,'ingest.json'),'utf8'));
  assert.equal(manifest.item.technical.streams[0].height,1080);assert.deepEqual(manifest.mediaSignature,signature(f.original));
  assert.equal(f.store.files()[0]!.size,fs.statSync(f.original).size);
 }finally{f.close();}
});

test('invalid height, source identity, runtime, or missing audio leave originals intact',()=>{
 for(const change of ['height','identity','duration','audio']){
  const f=fixture();try{
   if(change==='height')f.probe.streams[0]!.height=360;
   if(change==='duration')f.probe.format.duration='90';
   if(change==='audio')f.probe.streams.pop();
   assert.throws(()=>installQualityReplacement({...f,...(change==='identity'?{sourceId:'other-source'}:{})}));
   assert.equal(fs.readFileSync(f.original,'utf8'),'old low resolution');assert.equal(fs.existsSync(f.prepared),true);
  }finally{f.close();}
 }
});

test('an on-air guard defers swapping, then the same prepared file installs when safe',()=>{
 const f=fixture();try{
  assert.throws(()=>installQualityReplacement({...f,guard:()=>{throw new Deferred('on air');}}),Deferred);
  assert.equal(fs.readFileSync(f.original,'utf8'),'old low resolution');
  installQualityReplacement(f);assert.equal(fs.existsSync(f.dir),false);
 }finally{f.close();}
});

test('SQLite failure rolls back the filesystem swap and retains the prepared replacement',()=>{
 const f=fixture();try{
  f.db.db.exec("CREATE TRIGGER reject_swap BEFORE UPDATE ON media_items BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(()=>installQualityReplacement(f),/test failure/);
  assert.equal(fs.readFileSync(f.original,'utf8'),'old low resolution');assert.equal(fs.existsSync(f.prepared),true);
  assert.equal(fs.existsSync(path.join(f.dir,'swap.json')),false);
  f.db.db.exec('DROP TRIGGER reject_swap');installQualityReplacement(f);
  assert.equal(f.db.listMedia(false).length,1);
 }finally{f.close();}
});

test('restart recovers a filesystem swap interrupted before SQLite commit',()=>{
 const f=fixture();try{
  f.db.db.exec("CREATE TRIGGER reject_swap BEFORE UPDATE ON media_items BEGIN SELECT RAISE(ABORT,'test crash'); END;");
  let checks=0;
  assert.throws(()=>installQualityReplacement({...f,guard:()=>{if(++checks===3)throw new Deferred('interrupted recovery');}}));
  assert.equal(fs.existsSync(path.join(f.dir,'swap.json')),true);
  assert.equal(recoverQualityReplacement(f.db,f.original,f.dir,()=>{}),false);
  assert.equal(fs.readFileSync(f.original,'utf8'),'old low resolution');assert.equal(fs.existsSync(f.prepared),true);
  f.db.db.exec('DROP TRIGGER reject_swap');installQualityReplacement(f);
  assert.equal(fs.existsSync(f.dir),false);
 }finally{f.close();}
});

test('restart finishes cleanup after a committed swap without creating another asset',()=>{
 const f=fixture(),remove=fs.rmSync;try{
  fs.rmSync=((target,...args)=>{if(String(target)===f.dir)throw new Error('cleanup interrupted');return remove(target,...args);}) as typeof fs.rmSync;
  assert.throws(()=>installQualityReplacement(f),/cleanup interrupted/);
  fs.rmSync=remove;
  assert.equal(fs.existsSync(path.join(f.dir,'original.rollback')),true);
  assert.equal(recoverQualityReplacement(f.db,f.original,f.dir,()=>{}),true);
  assert.equal(fs.existsSync(f.dir),false);assert.equal(f.db.listMedia(false).length,1);
  assert.equal(fs.readFileSync(f.original,'utf8'),'validated high resolution replacement');
 }finally{fs.rmSync=remove;f.close();}
});
