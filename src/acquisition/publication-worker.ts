import { parentPort,workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { LkpDatabase } from '../database.js';
import { ensureSchedule,rebuildFutureSchedule } from '../schedule.js';
import { writeEpgAtomic } from '../epg.js';
import { readPlayoutStatus } from '../playout-status.js';
import { BroadcastGuard, Deferred, failureCode } from './io.js';
import { loadAcquisitionConfig,type AcquisitionConfig } from './model.js';
import type { AppConfig } from '../types.js';

const {app,guardSeconds,deadline,policy}=workerData as {app:AppConfig;guardSeconds:number;deadline:number;policy?:AcquisitionConfig};
let stage:'open'|'guard'|'backup'|'schedule'|'epg'='open';
let db:LkpDatabase|undefined;
try {
  db=new LkpDatabase(app.storage.database);
  const guard=new BroadcastGuard(app,db,policy??loadAcquisitionConfig(app),deadline);
  const check=()=>{guard.check();parentPort?.postMessage({type:'progress'});};
  stage='guard';
  check();
  const now=Date.now(),bounds=db.scheduleBounds();
  if(!bounds){stage='schedule';ensureSchedule(db,app);}
  else {
    const status=readPlayoutStatus(path.join(app.storage.runtimeDirectory,'playout-status.json'));
    const ids=[status?.current?.scheduleEntryId,status?.next?.scheduleEntryId].filter(Boolean);
    const weather=db.db.prepare("SELECT MAX(ends_at_ms) end FROM schedule_entries WHERE show_id='lkp-weather' AND ends_at_ms>?").get(now) as {end:number|null};
    let earliest=Math.max(now+guardSeconds*1000,app.station?.enabled?0:weather.end??0);
    for(const id of ids){const row=db.db.prepare('SELECT ends_at_ms FROM schedule_entries WHERE id=?').get(id) as {ends_at_ms:number}|undefined;if(row)earliest=Math.max(earliest,row.ends_at_ms);}
    const backup=`${app.storage.database}.before-acquisition.sqlite`;
    stage='backup';
    await db.db.backup(backup);fs.chmodSync(backup,0o600);check();
    stage='schedule';
    rebuildFutureSchedule(db,app,earliest,{check,onProgress:check,untilMs:now+7*86400000});
  }
  check();
  stage='epg';
  writeEpgAtomic(db.listSchedule(now-86400000,now+app.schedule.epgDays*86400000),app);
  parentPort?.postMessage({type:'completed'});
} catch (error) {
  // No provider data, paths or credentials cross the worker boundary.
  const message=error instanceof Error?error.message:'';
  const code=error instanceof Deferred?'GUARD_DEFERRED':/Children filler cannot close/.test(message)?'FILLER_CYCLE':
    /Schedule changed during rebuild/.test(message)?'SCHEDULE_CHANGED':/boundary expired/.test(message)?'BOUNDARY_EXPIRED':failureCode(error);
  parentPort?.postMessage({type:'failed',stage,code});
} finally {db?.close();}
