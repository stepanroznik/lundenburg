#!/usr/bin/env node
// One bounded, read-only observation of acquisition; no provider requests.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

const release=fs.realpathSync(process.env.LKP_ACQUISITION_RELEASE??'/home/lundenburg/lkp-content/current');
const {loadConfig}=await import(pathToFileURL(path.join(release,'dist/src/config.js')));
const app=loadConfig(),start=Date.now(),end=start+24*60*60_000,interval=15*60_000;
const directory=path.join(app.storage.runtimeDirectory,'acquisition');fs.mkdirSync(directory,{recursive:true,mode:0o700});
const output=path.join(directory,`observation-${start}.jsonl`);
fs.writeFileSync(output,'',{flag:'wx',mode:0o600});
console.log(`Acquisition observation: ${output}`);
function sample(){
  const now=Date.now(),record={at:now,startedAt:start,complete:now>=end};
  try{
    const db=new Database(app.storage.database,{readonly:true,fileMustExist:true});
    try{
      db.pragma('busy_timeout = 1500');
      record.acquired=db.prepare("SELECT COUNT(*) count,MAX(acquired_at) latest FROM acquisition_files WHERE new_asset=1 AND state='indexed'").get();
      record.schedule=db.prepare("SELECT event,COUNT(*) count FROM acquisition_history WHERE item='schedule' AND at>=? GROUP BY event").all(start);
      record.candidates=db.prepare('SELECT state,COUNT(*) count FROM acquisition_candidates GROUP BY state').all();
    }finally{db.close();}
  }catch{record.database='unavailable';}
  try{
    const state=JSON.parse(fs.readFileSync(path.join(directory,'worker-status.json'),'utf8'));
    record.worker={activity:state.activity,phase:state.phase,updatedAtMs:state.updatedAtMs};
  }catch{record.worker={activity:'unavailable'};}
  try{
    const raw=execFileSync('systemctl',['show','lkp-content.service','-p','ActiveState','-p','SubState','-p','Result','-p','CPUUsageNSec','-p','MemoryCurrent'],{encoding:'utf8',timeout:5000});
    record.service=Object.fromEntries(raw.trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
  }catch{record.service={ActiveState:'unavailable'};}
  try{const s=fs.statfsSync(app.media.root);record.freeBytes=s.bavail*s.bsize;}catch{record.freeBytes=null;}
  fs.appendFileSync(output,JSON.stringify(record)+'\n',{mode:0o600});
}
for(;;){sample();const remaining=end-Date.now();if(remaining<=0)break;await new Promise(resolve=>setTimeout(resolve,Math.min(interval,remaining)));}
