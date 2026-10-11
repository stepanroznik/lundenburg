import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { config, item } from './helpers.js';
import { LkpDatabase } from '../src/database.js';
import { ContentAcquisition } from '../src/acquisition/service.js';
import { AcquisitionStore } from '../src/acquisition/store.js';
import { loadAcquisitionConfig, admission, logicalKeys, type Candidate, type Subscription } from '../src/acquisition/model.js';
import { normalizeMediathek, ctCards } from '../src/acquisition/sources.js';
import { BroadcastGuard, Deferred, DownloadHttpError, download, reserve, progressWatch } from '../src/acquisition/io.js';
import { validateSrt } from '../src/acquisition/enrichment.js';
import { buildScheduleEntries, validateTimeline } from '../src/schedule.js';
import { writePlayoutStatus } from '../src/playout-status.js';

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lkp-content-')),app=config(root);
  fs.mkdirSync(app.media.root,{recursive:true});
  const policy=loadAcquisitionConfig({...app,projectRoot:path.resolve('.')});
  policy.reserveBytes=1;policy.maxNewBytes=160*2**30;for(const subscription of policy.subscriptions)subscription.maxBytes=64*2**30;policy.copyBytesPerSecond=50*1024*1024;policy.stableSeconds=1;policy.metadataRequestsPerRun=0;policy.credentialsFile=path.join(root,'absent.env');
  const sub:Subscription={...policy.subscriptions.find(s=>s.id==='bobo-siebenschlaefer')!,source:'manual',minDuration:.5,maxDuration:10};
  policy.subscriptions=[sub];const db=new LkpDatabase(app.storage.database),service=new ContentAcquisition(app,db,policy);
  service.store.set('educational-subscriptions-v1','1');service.store.set('collection-limit-normalization-20261010','1');const close=()=>{db.close();fs.rmSync(root,{recursive:true,force:true});};return {root,app,policy,sub,db,service,close};
}
function candidate(s:Subscription):Candidate {return {source:'mediathek',sourceId:'1',sourceUrl:'https://example.org/1',showId:s.id,title:'Bobo im Bad',language:s.language,description:'Eine verlässliche deutsche Beschreibung der Geschichte.',descriptionLanguage:'de',durationMs:420000,size:100000,broadcaster:'KiKA',components:[],compilation:false,format:'episode',available:true};}

test('VPN fallback requires an authenticated private token, German public media and HTTP 403',()=>{
  const {root,service,policy,sub,close}=fixture();try{
    const helper=path.join(root,'vpn.py'),token=path.join(root,'token');
    policy.vpnFallback={enabled:true,helper,tokenFile:token};
    const c=candidate(sub);
    assert.equal(service.canUseVpn(c,403),false);
    fs.writeFileSync(helper,'helper');fs.writeFileSync(token,'private token',{mode:0o600});
    assert.equal(service.canUseVpn(c,403),true);
    assert.equal(service.canUseVpn(c,404),false);assert.equal(service.canUseVpn(c,429),false);
    assert.equal(service.canUseVpn({...c,language:'en'},403),false);
    assert.equal(service.canUseVpn({...c,source:'ct'},403),false);
    assert.equal(service.canUseVpn({...c,broadcaster:'ORF'},403),false);
    fs.chmodSync(token,0o644);assert.equal(service.canUseVpn(c,403),false);
    fs.chmodSync(token,0o600);policy.vpnFallback.enabled=false;assert.equal(service.canUseVpn(c,403),false);
  }finally{close();}
});

test('HTTP errors retain their status for VPN selection and never become completed media',async()=>{
  const {root,policy,close}=fixture(),original=globalThis.fetch;
  try{
    for(const status of [403,404,429]){
      globalThis.fetch=async()=>new Response('unavailable',{status});
      const partial=path.join(root,`source-${status}.mp4.part`);
      await assert.rejects(download('https://example.org/media',partial,1000,policy,()=>{}),error=>error instanceof DownloadHttpError&&error.status===status);
      assert.equal(fs.statSync(partial).size,0);
    }
  }finally{globalThis.fetch=original;close();}
});

test('automatic scheduling continues eligible work and respects retry delays, caps and runtime protection',()=>{
  const {service,sub,close}=fixture();try{
    sub.source='mediathek';service.store.set('inventory-complete','1');
    const now=Date.now();service.store.set('last-discovery',String(now));
    const id=service.store.remember({...candidate(sub),durationMs:2000});
    assert.equal(service.nextAutomaticRunAt({},now),now);
    service.store.transition(id,'deferred','source failure',now+5*60000);
    assert.equal(service.nextAutomaticRunAt({},now),now+5*60000);
    assert.equal(service.nextAutomaticRunAt({deferred:'Playout recovery is active'},now),now+1800000);
    const other=service.store.remember({...candidate(sub),durationMs:2000,sourceId:'2',sourceUrl:'https://example.org/2',title:'Bobo im Garten'});
    assert.equal(service.nextAutomaticRunAt({},now),now);
    service.store.transition(other,'quarantine','ambiguous');sub.maxBytes=1;
    assert.equal(service.nextAutomaticRunAt({},now),now+1800000);
    sub.maxBytes=1000000;sub.source='manual';
    assert.equal(service.nextAutomaticRunAt({},now),now+1800000);
  }finally{close();}
});

test('scheduled batches immediately move past a failed item, cache discovery and do no media work while idle',async()=>{
  const {service,sub,policy,close}=fixture();try{
    sub.source='mediathek';policy.jobsPerRun=1;service.store.set('inventory-complete','1');
    service.store.remember({...candidate(sub),durationMs:2000});
    service.store.remember({...candidate(sub),durationMs:2000,sourceId:'2',sourceUrl:'https://example.org/2',title:'Bobo im Garten'});
    let scans=0,discoveries=0,attempts=0;
    const stub=service as unknown as {recover:()=>Promise<void>;index:()=>Promise<{files:number;pending:number}>;discover:()=>Promise<{discovered:number;errors:number}>;incoming:()=>Promise<number>;enrichExisting:()=>Promise<number>;regenerate:()=>Promise<void>;ingest:(row:{id:string})=>Promise<void>};
    stub.recover=async()=>{};stub.index=async()=>{scans++;return {files:0,pending:0};};
    stub.discover=async()=>{discoveries++;service.store.set('last-discovery',String(Date.now()));return {discovered:2,errors:0};};
    stub.incoming=async()=>0;stub.enrichExisting=async()=>0;stub.regenerate=async()=>{};
    stub.ingest=async row=>{attempts++;if(attempts===1)throw new Error('source unavailable');service.store.transition(row.id,'imported');};
    assert.equal((await service.run({scheduled:true})).imported,0);
    assert.ok(Number(service.store.state('next-automatic-run'))<=Date.now());
    assert.equal((await service.run({scheduled:true})).imported,1);
    assert.equal(discoveries,1);assert.equal(attempts,2);
    const retry=service.store.candidates(['deferred'])[0]!;
    assert.ok(retry.retryAt>Date.now());assert.equal(retry.attempts,1);
    assert.ok(Number(service.store.state('next-automatic-run'))>Date.now());
    assert.ok((await service.run({scheduled:true})).idleUntil);assert.equal(scans,2);assert.equal(discoveries,1);
  }finally{close();}
});

test('approved shortlist is bounded; Bluey and complete collections cannot be subscribed to downloads',()=>{
  const {policy,close}=fixture();try{assert.ok(policy.maxNewBytes>policy.reserveBytes);}finally{close();}
  const c=loadAcquisitionConfig({...config('.'),projectRoot:path.resolve('.')});
  assert.equal(c.subscriptions.find(s=>s.id==='bluey')!.source,'existing');
  for(const excluded of ['masha','baby-einstein','thomas','shaun','broucci','ferda','pohadky-z-mechu'])assert.ok(!c.subscriptions.some(s=>s.id.includes(excluded)));
  for(const s of c.subscriptions)assert.ok(s.targetEpisodes<=s.maxEpisodes&&s.maxBytes>0);
});

test('curation rejects loose news matches, clips, unwanted compilations and over-budget candidates',()=>{
  const {sub,policy,close}=fixture();try{
    const normal={...sub,minDuration:240,maxDuration:600};const c=candidate(normal);
    assert.equal(normalizeMediathek({topic:'tagesschau24',title:'Bobo interview'},normal),undefined);
    assert.equal(admission(c,normal,{episodes:0,durationMs:0,bytes:0},0,policy),undefined);
    assert.match(admission({...c,title:'Bobo Trailer'},normal,{episodes:0,durationMs:0,bytes:0},0,policy)!,/clip/);
    assert.match(admission({...c,compilation:true},normal,{episodes:0,durationMs:0,bytes:0},0,policy)!,/compilation/);
    assert.match(admission(c,normal,{episodes:normal.targetEpisodes,durationMs:0,bytes:0},0,policy)!,/target/);
    assert.match(admission(c,normal,{episodes:0,durationMs:0,bytes:normal.maxBytes},0,policy)!,/byte budget/);
  }finally{close();}
});

test('logical episode identities distinguish dubbed editions and unify neutral editions',()=>{
  const c={showId:'peppa',title:'Mud!',season:1,episode:2,language:'de' as const};
  assert.ok(!logicalKeys(c).some(k=>logicalKeys({...c,language:'en'}).includes(k)));
  assert.deepEqual(logicalKeys({...c,title:'MUD',language:'neutral'}),logicalKeys({...c,language:'neutral'}));
});

test('persistent source identity, manual notifications and worker leases are idempotent',()=>{
  const {db,sub,close}=fixture();try{
    const store=new AcquisitionStore(db),id=store.remember(candidate(sub));store.remember(candidate(sub));assert.equal(store.candidates().length,1);
    store.manual(id,sub.id,'unavailable',id);store.manual(id,sub.id,'unavailable',id);
    assert.equal((db.db.prepare('SELECT count(*) n FROM acquisition_history').get() as {n:number}).n,1);
    assert.ok(store.acquire('a'));assert.ok(!store.acquire('b'));store.release('a');assert.ok(store.acquire('b'));store.release('b');
    assert.ok(store.acquire('987654321:exited'));assert.ok(store.acquire('replacement'));store.release('replacement');
  }finally{close();}
});

test('incremental canonical upsert does not disable other catalogue items',()=>{
  const {db,close}=fixture();try{db.replaceMedia([item('a',1),item('b',1)]);db.upsertMedia([item('c',1)]);assert.equal(db.listMedia().length,3);}finally{close();}
});

test('ČT monitor parses only episode cards below an approved programme root',()=>{
  const {sub,close}=fixture();try{
    const c=ctCards('<a href="/porady/1-bobo/12345/"><h3>2/10 Koupel</h3><p>Příběh.</p><span>7 min</span><svg data-testid="icon-playable"></svg></a><a href="/porady/other/12345/"><h3>Not approved</h3></a>','https://www.ceskatelevize.cz/porady/1-bobo/',{...sub,language:'cs'});
    assert.equal(c.length,1);assert.equal(c[0]!.episode,2);assert.equal(c[0]!.durationMs,420000);assert.ok(c[0]!.available);
  }finally{close();}
});

test('storage and live playout gates fail closed without modifying scheduled files',()=>{
  const {app,db,policy,close}=fixture();try{
    assert.throws(()=>reserve(app.media.root,Number.MAX_SAFE_INTEGER,1),Deferred);
    writePlayoutStatus(path.join(app.storage.runtimeDirectory,'playout-status.json'),{version:1,state:'running',updatedAtMs:Date.now(),pid:process.pid,leadMs:-6000,driftMs:0,direction:'on-time',current:null,next:null});
    const guard=new BroadcastGuard(app,db,policy,Date.now()+60000);assert.throws(()=>guard.check(),Deferred);
    writePlayoutStatus(path.join(app.storage.runtimeDirectory,'playout-status.json'),{version:1,state:'running',updatedAtMs:Date.now()-20000,pid:987654321,leadMs:0,driftMs:0,direction:'on-time',current:null,next:null});
    assert.doesNotThrow(()=>guard.check());
  }finally{close();}
});

test('grossly out-of-sync subtitles are rejected instead of attached by title',()=>{
  assert.ok(validateSrt('1\n00:00:01,000 --> 00:00:02,000\nHallo\n',3000));
  assert.ok(!validateSrt('1\n00:05:01,000 --> 00:05:02,000\nHallo\n',3000));
  assert.ok(!validateSrt('This is not a subtitle',3000));
});

test('airtime quotas account for durations, while neutral programmes remain outside spoken totals',()=>{
  const {app,close}=fixture();try{
    app.schedule.spokenLanguageTargets={de:.55,en:.30,cs:.15};
    const media=[{...item('de',1,7*60000),audioLanguage:'de'},{...item('en',1,20*60000),audioLanguage:'en'},{...item('cs',1,5*60000),audioLanguage:'cs'},{...item('neutral',1,8*60000),audioLanguage:'zxx'}];
    const entries=buildScheduleEntries(media,'ratios',Date.now(),Date.now()+7*86400000,0,[],{config:app,ads:[],clips:[],bumpers:[]});
    const spoken=entries.filter(e=>e.audioLanguage!=='zxx'),total=spoken.reduce((a,e)=>a+e.durationMs,0);
    for(const [language,target] of Object.entries(app.schedule.spokenLanguageTargets))assert.ok(Math.abs(spoken.filter(e=>e.audioLanguage===language).reduce((a,e)=>a+e.durationMs,0)/total-target)<.04);
    assert.ok(entries.some(e=>e.audioLanguage==='zxx'));assert.deepEqual(validateTimeline(entries),[]);
  }finally{close();}
});

test('stable manual media imports, closes pending source record, and a metadata duplicate is quarantined',async()=>{
  const {app,policy,sub,db,service,close}=fixture();try{
    await service.index(0);const incoming=path.join(app.media.root,'.acquisition/incoming');
    const file=path.join(incoming,'bobo-siebenschlaefer__de__S01E01 - Bobo im Bad.mp4');
    execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=854x480:r=10:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-threads','1','-c:a','aac','-metadata:s:a:0','language=deu','-shortest',file]);
    fs.utimesSync(file,new Date(Date.now()-5000),new Date(Date.now()-5000));
    const pending=service.store.remember({...candidate(sub),season:1,episode:1,durationMs:2000});service.store.transition(pending,'manual','restricted');service.store.manual(`candidate:${pending}`,sub.id,'restricted',pending);
    const stat=fs.statSync(file);service.store.set(`incoming:${file}`,JSON.stringify({size:stat.size,mtime:stat.mtimeMs,at:Date.now()-5000}));
    assert.equal(await service.incoming(),1);
    const media=db.listMedia();assert.equal(media.length,1);assert.ok(fs.existsSync(media[0]!.mediaPath));assert.ok(!fs.existsSync(file));assert.equal(service.store.candidates(['imported']).length,2);
    assert.equal((db.db.prepare("SELECT count(*) n FROM acquisition_manual WHERE state='pending'").get() as {n:number}).n,0);
    const original=fs.readFileSync(media[0]!.mediaPath);fs.writeFileSync(file,original);fs.utimesSync(file,new Date(Date.now()-5000),new Date(Date.now()-5000));const again=fs.statSync(file);service.store.set(`incoming:${file}`,JSON.stringify({size:again.size,mtime:again.mtimeMs,at:Date.now()-5000}));
    assert.equal(await service.incoming(),0);assert.equal(db.listMedia().length,1);assert.ok(!fs.existsSync(file));assert.deepEqual(fs.readFileSync(media[0]!.mediaPath),original);
    assert.ok(fs.existsSync(path.join(app.media.root,'.acquisition/quarantine')));
    assert.equal(policy.metadataRequestsPerRun,0);
  }finally{close();}
});

test('silent neutral media acquires audio without re-encoding compatible video',async()=>{
  const {app,policy,sub,db,service,close}=fixture();try{
    sub.language='neutral';
    service.store.set('inventory-complete','1');
    const incoming=path.join(app.media.root,'.acquisition/incoming');fs.mkdirSync(incoming,{recursive:true});
    const file=path.join(incoming,'bobo-siebenschlaefer__neutral__S01E01 - Silent.mp4');
    execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=854x480:r=10:d=2','-c:v','libx264','-threads','1',file]);
    const videoBytes=(name:string)=>execFileSync('ffmpeg',['-nostdin','-v','error','-i',name,'-map','0:v:0','-c','copy','-f','h264','-']);
    const originalVideo=videoBytes(file);
    fs.utimesSync(file,new Date(Date.now()-5000),new Date(Date.now()-5000));const stat=fs.statSync(file);
    service.store.set(`incoming:${file}`,JSON.stringify({size:stat.size,mtime:stat.mtimeMs,at:Date.now()-5000}));
    assert.equal(await service.incoming(),1,JSON.stringify(service.report('history')));
    const media=db.listMedia()[0]!;assert.equal(media.audioLanguage,'zxx');assert.deepEqual(videoBytes(media.mediaPath),originalVideo);
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',media.mediaPath],{encoding:'utf8'}));
    assert.ok(probe.streams.some((s:{codec_type:string})=>s.codec_type==='audio'));assert.equal(policy.metadataRequestsPerRun,0);
  }finally{close();}
});

test('completed downloads are reused and metadata is trusted without decoding or whole-file fingerprints',async()=>{
  const {app,sub,db,service,close}=fixture();const originalFetch=globalThis.fetch;try{
    await service.index(0);sub.source='mediathek';sub.maxDuration=600;
    const c={...candidate(sub),title:'Trusted source episode',durationMs:240000};
    const id=service.store.remember(c),dir=path.join(app.media.root,'.acquisition/staging',id);fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,'source.mp4');fs.writeFileSync(file,Buffer.alloc(200000,1));
    const stat=fs.statSync(file);
    // Cached headers deliberately differ from source runtime and audio-language tags.
    // The fake bytes would fail a full decode; ingestion must use only these headers.
    db.db.prepare('INSERT INTO acquisition_probe_cache VALUES(?,?,?,?)').run(file,stat.size,stat.mtimeMs,JSON.stringify({format:{duration:'2'},streams:[{index:0,codec_type:'video',codec_name:'h264',width:854,height:480},{index:1,codec_type:'audio',codec_name:'aac',tags:{language:'eng'}}]}));
    globalThis.fetch=async()=>{throw new Error('Completed download must not be fetched again');};
    const worker=service as unknown as {ingest(row:ReturnType<typeof service.store.candidates>[number],source:undefined):Promise<void>};
    await worker.ingest(service.store.candidates()[0]!,undefined);
    assert.equal(db.listMedia().length,1);assert.equal(db.listMedia()[0]!.audioLanguage,'de');
    assert.ok(!('sha256' in service.store.files()[0]!));
    assert.ok(!('sha256' in (db.listMedia()[0]!.technical.acquisition as object)));
    assert.ok(!('hashesPending' in (service.report('status') as object)));
  }finally{globalThis.fetch=originalFetch;close();}
});

test('post-credit chapter ranges remain intact when a credits segment has no explicit end',async()=>{
  const {creditAwareRanges,editorialEnd}=await import('../src/editorial.js');
  const markers=[{kind:'credits' as const,startMs:100000,source:'manual' as const,confidence:1},{kind:'post-credits' as const,startMs:200000,endMs:250000,source:'manual' as const,confidence:1}];
  const ranges=creditAwareRanges(300000,markers,'shorten');
  assert.ok(ranges.some(r=>r.type==='content'&&r.fromMs===200000&&r.toMs===250000));assert.equal(editorialEnd(markers,300000),150000);
});

test('resumable download verifies ranges and never exposes a partial HTTP body as media',async()=>{
  const {download}=await import('../src/acquisition/io.js');const {root,policy,close}=fixture();const original=globalThis.fetch;
  const partial=path.join(root,'video.mp4.part');fs.writeFileSync(partial,'abc');fs.writeFileSync(`${partial}.resume.json`,JSON.stringify({etag:'etag-v1',url:'https://example.org/video.mp4'}));
  try{
    globalThis.fetch=async(_url,init)=>{assert.deepEqual(init?.headers,{Range:'bytes=3-','If-Range':'etag-v1'});return new Response('def',{status:206,headers:{'content-range':'bytes 3-5/6','content-length':'3',etag:'etag-v1'}});};
    await download('https://example.org/video.mp4',partial,100,policy,()=>{});assert.equal(fs.readFileSync(partial,'utf8'),'abcdef');assert.ok(!fs.existsSync(path.join(root,'video.mp4')));
    globalThis.fetch=async()=>new Response('x',{headers:{'content-length':'20'}});
    await assert.rejects(download('https://example.org/other.mp4',partial,100,policy,()=>{}),/Truncated/);
  }finally{globalThis.fetch=original;close();}
});

test('broadcaster TTML captions convert and reject unresolvable relative offsets',async()=>{
  const {ttmlToSrt}=await import('../src/acquisition/enrichment.js');
  const srt=ttmlToSrt('<tt><body><div><p begin="00:00:01.000" end="00:00:02.000">Hallo<br/>Welt &amp; Bobo</p></div></body></tt>')!;
  assert.ok(validateSrt(srt,3000));assert.ok(srt.includes('Welt & Bobo'));
  assert.throws(()=>ttmlToSrt('<tt><body begin="2s"><p begin="1s" end="2s">Relative</p></body></tt>'));
});

test('ČT GraphQL normalization refuses unrelated programmes and retains exact episode runtimes',async()=>{
  const {ctGraphCandidate}=await import('../src/acquisition/sources.js');const {sub,close}=fixture();try{
    const base='https://www.ceskatelevize.cz/porady/123-bobo/';
    assert.equal(ctGraphCandidate({showId:'999',id:'10',title:'Unapproved'},base,sub),undefined);
    const c=ctGraphCandidate({showId:'123',id:'1000',title:'2/10 Bobo im Bad',duration:421,description:'Příběh.',playable:true,season:{id:'s1',title:'1. řada'}},base,sub)!;
    assert.equal(c.episode,2);assert.equal(c.season,1);assert.equal(c.durationMs,421000);assert.ok(c.available);
  }finally{close();}
});

test('free SubDL lookup requires exact programme/episode and a confident release match',async()=>{
  const {matchSubdl}=await import('../src/acquisition/subdl.js');const {sub,close}=fixture();try{
    const media={...item(sub.id,1,5000),showTitle:sub.title};const c={...candidate(sub),season:1,episode:1};
    const data={status:true,match:{engine:'local',confidence:'high',degraded:false,type:'tv',title:sub.title,season:1,episode:1},subtitles:[{n_id:'subtitle-1',release_name:'Bobo.S01E01.WEB',language:'german',match_score:.92}]};
    assert.equal(matchSubdl(data,media,c,sub).length,1);
    for(const changed of [{episode:2},{title:'Unrelated series'},{confidence:'low'},{engine:'ai'},{degraded:true},{full_season:true}])assert.equal(matchSubdl({...data,match:{...data.match,...changed}},media,c,sub).length,0);
    assert.equal(matchSubdl({...data,subtitles:[{...data.subtitles[0],match_score:.4}]},media,c,sub).length,0);
    assert.equal(matchSubdl({...data,subtitles:[{release_name:'Bobo',language:'german',match_score:.9,url:'https://example.org/subtitle/x/y'}]},media,c,sub).length,0);
  }finally{close();}
});

test('free SubDL searches and imports captions with bounded calls; missing credentials make no requests',async()=>{
  const {enrichSubtitles}=await import('../src/acquisition/enrichment.js');const {root,policy,sub,close}=fixture();const original=globalThis.fetch;try{
    const media={...item(sub.id,1,5000),showTitle:sub.title,mediaPath:path.join(root,'episode.mp4'),subtitles:[]};
    const c={...candidate(sub),season:1,episode:1};let searches=0,downloads=0,calls=0;
    policy.subtitleProviders=[{name:'subdl',keyEnv:'SUBDL_API_KEY'}];
    globalThis.fetch=async(input,init)=>{
      calls++;const url=new URL(String(input));assert.equal(url.hostname,'api.subdl.com');
      if(url.pathname==='/api/v2/files/search'){
        assert.equal(url.searchParams.get('engine'),'local');assert.equal(url.searchParams.get('episode_scope'),'exact');
        return new Response(JSON.stringify({status:true,match:{engine:'local',confidence:'high',type:'tv',title:sub.title,season:1,episode:1},subtitles:[{n_id:'fixture-caption',release_name:'Bobo.S01E01.WEB',lang:'german',match_score:.95}]}));
      }
      assert.ok(url.pathname.endsWith('/download'));assert.equal(url.searchParams.get('format'),'file');
      return new Response('1\n00:00:01,000 --> 00:00:02,000\nHallo\n');
    };
    assert.deepEqual(await enrichSubtitles(media,c,policy,()=>{}),[]);assert.equal(calls,0);
    fs.writeFileSync(policy.credentialsFile,'SUBDL_API_KEY=fixture-placeholder\n',{mode:0o600});
    const budget=(kind:'search'|'download')=>{if(kind==='search')searches++;else downloads++;return true;};
    const tracks=await enrichSubtitles(media,c,policy,()=>{},budget);
    assert.equal(tracks[0]!.provider,'subdl');assert.equal(tracks[0]!.language,'de');assert.equal(tracks[0]!.syncStatus,'unknown');
    assert.ok(fs.existsSync(tracks[0]!.path!));assert.equal(searches,1);assert.equal(downloads,1);assert.equal(calls,2);
    const before=calls;await enrichSubtitles(media,c,policy,()=>{},()=>false);assert.equal(calls,before);
  }finally{globalThis.fetch=original;close();}
});

test('healthy transfers outlive the batch duration and throttling does not count as a network stall',async()=>{
  const {root,policy,close}=fixture(),original=globalThis.fetch;
  policy.maxRunSeconds=.01;policy.connectTimeoutSeconds=1;policy.downloadStallSeconds=.02;policy.downloadBytesPerSecond=20;
  try {
    globalThis.fetch=async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([1,2,3,4]));controller.close();}}),{headers:{'content-length':'4'}});
    const partial=path.join(root,'healthy.part');
    await download('https://example.org/media',partial,100,policy,()=>{});
    assert.equal(fs.statSync(partial).size,4);
  }finally{globalThis.fetch=original;close();}
});

test('stalled network reads abort cleanly, retaining partial bytes for resumption',async()=>{
  const {root,policy,close}=fixture(),original=globalThis.fetch;policy.downloadStallSeconds=.04;
  try {
    globalThis.fetch=async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([1,2,3]));}}),{headers:{etag:'stable','content-length':'6'}});
    const partial=path.join(root,'stalled.part');
    await assert.rejects(download('https://example.org/media',partial,100,policy,()=>{}),/Download stalled/);
    assert.equal(fs.statSync(partial).size,3);assert.ok(fs.existsSync(`${partial}.resume.json`));
  }finally{globalThis.fetch=original;close();}
});

test('connection deadline aborts before headers arrive',async()=>{
  const {root,policy,close}=fixture(),original=globalThis.fetch;policy.connectTimeoutSeconds=.03;
  try {
    globalThis.fetch=async(_url,options)=>new Promise<Response>((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(options!.signal!.reason),{once:true}));
    await assert.rejects(download('https://example.org/media',path.join(root,'connect.part'),100,policy,()=>{}),/connection timed out/);
  }finally{globalThis.fetch=original;close();}
});

test('external progress watchdog permits healthy growth but rejects a stuck process',()=>{
  let bytes=0,time=0;const watch=progressWatch(()=>bytes,2,()=>time);
  time=1900;watch();bytes=1;time=2100;watch();time=4000;watch();time=4100;
  assert.throws(watch,/stalled/);
});

test('soft batch deadline finishes and imports the current item, then immediately queues remaining work',async()=>{
  const {service,sub,policy,close}=fixture();try{
    sub.source='mediathek';policy.maxRunSeconds=.08;service.store.set('inventory-complete','1');service.store.set('last-discovery',String(Date.now()));
    service.store.remember({...candidate(sub),durationMs:2000});service.store.remember({...candidate(sub),durationMs:2000,sourceId:'2',sourceUrl:'https://example.org/2',title:'Bobo im Garten'});
    const stub=service as unknown as {recover:()=>Promise<void>;index:()=>Promise<unknown>;incoming:()=>Promise<number>;enrichExisting:()=>Promise<number>;regenerate:()=>Promise<void>;ingest:(row:{id:string})=>Promise<void>};
    stub.recover=async()=>{};stub.index=async()=>({});stub.incoming=async()=>0;stub.enrichExisting=async()=>0;stub.regenerate=async()=>{};
    stub.ingest=async row=>{await new Promise(resolve=>setTimeout(resolve,120));service.store.transition(row.id,'imported');};
    const result=await service.run({scheduled:true});assert.equal(result.imported,1);assert.equal(result.batchLimitReached,true);
    assert.equal(service.store.candidates(['imported']).length,1);assert.ok(Number(service.store.state('next-automatic-run'))<=Date.now());
  }finally{close();}
});

test('status exposes active episode progress without source URLs and ignores orphaned/stale partials',()=>{
  const {root,service,sub,close}=fixture();try{
    const id=service.store.remember(candidate(sub));const dir=path.join(service.root,'staging',id);fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,'source.mp4.part');fs.writeFileSync(file,'12345');
    const status=()=>service.report('status') as {currentDownloads:Array<{title:string;downloadedBytes:number}>};
    assert.equal(status().currentDownloads.length,0);
    const owner=`${process.pid}:status-test`;assert.ok(service.store.acquire(owner));
    service.store.set('active-download',JSON.stringify({id,pid:process.pid}));
    const current=status().currentDownloads;assert.equal(current[0]?.title,'Bobo im Bad');assert.equal(current[0]?.downloadedBytes,5);
    assert.ok(!JSON.stringify(current).includes('https://'));
    service.store.set('active-download',JSON.stringify({id,pid:99999999}));assert.equal(status().currentDownloads.length,0);
    service.store.set('active-download',JSON.stringify({id,pid:process.pid}));
    const old=new Date(Date.now()-10*60_000);fs.utimesSync(file,old,old);assert.equal(status().currentDownloads.length,0);
    service.store.release(owner);
  }finally{close();}
});

test('explicit Sorbian source editions cannot enter the German collection, including cached candidates',()=>{
  const {sub,policy,close}=fixture();try{
    const german={...candidate(sub),durationMs:2000};
    for(const label of ['sorbisch','Obersorbisch','Niedersorbisch','Sorbian']){
      const c={...german,title:`Kalli: Pirat | Unser Sandmännchen (${label})`};
      assert.match(admission(c,sub,{episodes:0,durationMs:0,bytes:0},0,policy)!,/Sorbian/);
      assert.equal(normalizeMediathek({topic:sub.title,title:c.title,url_video:'https://example.org/video'},sub),undefined);
    }
    assert.equal(admission(german,sub,{episodes:0,durationMs:0,bytes:0},0,policy),undefined);
  }finally{close();}
});

test('wrong language imports are disabled and retained for review with manual metadata preserved',()=>{
  const {root,service,sub,db,close}=fixture();try{
    const media={...item(sub.id,1),id:'wrong-edition',showId:sub.id,mediaPath:path.join(root,'sorbian.mp4')};fs.writeFileSync(media.mediaPath,'media');
    const metadata=path.join(root,'sorbian.yaml');fs.writeFileSync(metadata,'creditsPolicy: full\ndescription: Manuelle Beschreibung\n');db.upsertMedia([media]);
    const c={...candidate(sub),title:'Kalli (sorbisch)'},id=service.store.remember(c);service.store.transition(id,'imported','',0,media.id);
    const stat=fs.statSync(media.mediaPath);service.store.file({path:media.mediaPath,size:stat.size,mtime:stat.mtimeMs,show_id:sub.id,language:'de',keys_json:'[]',catalogue_id:media.id,state:'indexed',new_asset:1});
    (service as unknown as {quarantineUnsupportedEditions:()=>void}).quarantineUnsupportedEditions();
    assert.equal(db.listMedia(false)[0]?.enabled,false);assert.equal(service.store.candidates(['quarantine']).length,1);
    assert.ok(fs.existsSync(media.mediaPath));assert.match(fs.readFileSync(metadata,'utf8'),/creditsPolicy: full/);assert.match(fs.readFileSync(metadata,'utf8'),/enabled: false/);
    assert.equal(service.store.state('schedule-dirty'),'1');assert.equal(service.store.files()[0]?.state,'quarantine');
  }finally{close();}
});


test('resumed low-resolution and unknown-height downloads cannot enter the catalogue', async () => {
  for (const height of [360, undefined]) {
    const {app,sub,db,service,close}=fixture();
    try {
      await service.index(0);
      const id=service.store.remember({...candidate(sub),durationMs:2000});
      const dir=path.join(app.media.root,'.acquisition/staging',id);fs.mkdirSync(dir,{recursive:true});
      const file=path.join(dir,'source.mp4');fs.writeFileSync(file,Buffer.alloc(1000));
      const stat=fs.statSync(file);
      db.db.prepare('INSERT INTO acquisition_probe_cache VALUES(?,?,?,?)').run(file,stat.size,stat.mtimeMs,JSON.stringify({format:{duration:'2'},streams:[{index:0,codec_type:'video',codec_name:'h264',height},{index:1,codec_type:'audio',codec_name:'aac'}]}));
      await assert.rejects(service.ingest(service.store.candidates()[0]!,undefined), /480p acquisition minimum/);
      assert.equal(db.listMedia().length,0);
      assert.equal(fs.existsSync(file),true);
    } finally {close();}
  }
});
