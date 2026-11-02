import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {superviseBatch} from '../dist/src/acquisition/supervisor.js';
import {publishSchedule,publicationFailureSummary} from '../dist/src/acquisition/publication.js';
import {leaseRenewalMayWait} from '../dist/src/acquisition/store.js';
import {Deferred} from '../dist/src/acquisition/io.js';

test('independent supervisor detects a blocked event loop, kills its downloader group, and returns failure',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lkp-supervisor-'));
  try{
    const child=path.join(root,'blocked.mjs'),status=path.join(root,'status.json'),progress=path.join(root,'progress');
    fs.writeFileSync(child,`import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['-e',${JSON.stringify(`const fs=require('fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(progress)},'.'),20);`)}],{detached:true,stdio:'ignore'});
process.send({type:'child-group',pid:child.pid,active:true});process.send({type:'heartbeat',phase:'acquiring'});
setTimeout(()=>{while(true){}},100);
`);
    // Allow cold Node/tsx startup on the production ARM machine before testing the blocked loop.
    assert.equal(await superviseBatch(child,[],status,{stallMs:1500,pollMs:25,stopGraceMs:50}),1);
    const report=JSON.parse(fs.readFileSync(status,'utf8'));
    assert.equal(report.activity,'stalled');assert.equal(report.phase,'acquiring');
    assert.throws(()=>process.kill(report.workerPid,0),{code:'ESRCH'});
    const length=fs.existsSync(progress)?fs.statSync(progress).size:0;
    await new Promise(r=>setTimeout(r,100));
    assert.equal(fs.existsSync(progress)?fs.statSync(progress).size:0,length,'orphaned downloads must stop');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('schedule planning cannot block parent timers and a stalled planner is terminated',async()=>{
  let ticks=0;const timer=setInterval(()=>ticks++,10);
  try{
    const workerUrl=new URL('data:text/javascript,while(true){}');
    await assert.rejects(publishSchedule({},900,()=>{}, {workerUrl,stallMs:150,timeoutMs:2000}),/stalled/);
    assert.ok(ticks>=5,'lease and health timers remain responsive');
  }finally{clearInterval(timer);}
});

test('healthy planner progress outlives its idle watchdog',async()=>{
  const workerUrl=new URL('data:text/javascript,'+encodeURIComponent(`import {parentPort} from 'node:worker_threads';
const timer=setInterval(()=>parentPort.postMessage({type:'progress'}),20);
setTimeout(()=>{clearInterval(timer);parentPort.postMessage({type:'completed'});},2000);`));
  await publishSchedule({},900,()=>{}, {workerUrl,stallMs:1000,timeoutMs:5000});
});

test('publication failures report a safe stage and error category',async()=>{
  const workerUrl=new URL('data:text/javascript,'+encodeURIComponent(`import {parentPort} from 'node:worker_threads';
parentPort.postMessage({type:'failed',stage:'schedule',code:'FILLER_CYCLE'});`));
  await assert.rejects(publishSchedule({},900,()=>{},{workerUrl,stallMs:1000}),/schedule \(FILLER_CYCLE\)/);
  assert.match(publicationFailureSummary(new Deferred('Schedule publication deferred by runtime protection')),/RUNTIME_GUARD/);
  assert.doesNotMatch(publicationFailureSummary(new Error('sensitive provider URL https://example.test/?token=secret')),/secret|example/);
});

test('lease renewal tolerates transient write contention only before expiry',()=>{
  assert.equal(leaseRenewalMayWait({code:'SQLITE_BUSY'},200,100),true);
  assert.equal(leaseRenewalMayWait({code:'SQLITE_BUSY_SNAPSHOT'},200,100),true);
  assert.equal(leaseRenewalMayWait({code:'SQLITE_BUSY'},200,200),false);
  assert.equal(leaseRenewalMayWait(new Error('Acquisition lease lost'),200,100),false);
});

test('publication reports a safe guard failure category',async()=>{
  let checks=0;
  const workerUrl=new URL('data:text/javascript,setInterval(()=>{},1000)');
  await assert.rejects(publishSchedule({},900,()=>{
    if(++checks>1)throw Object.assign(new Error('sensitive path'),{code:'MEDIA_MOUNT_MISSING'});
  },{workerUrl,stallMs:50,timeoutMs:1000}),/guard \(MEDIA_MOUNT_MISSING\)/);
});
