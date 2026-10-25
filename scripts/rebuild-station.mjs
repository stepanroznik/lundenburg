// Read-only planning by default. --apply backs up and atomically replaces the
// future station tail after independent quality and concurrency checks.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {DateTime} from 'luxon';
import {loadConfig} from '../dist/src/config.js';
import {LkpDatabase} from '../dist/src/database.js';
import {childrenSettings,saveChildrenAge} from '../dist/src/children-settings.js';
import {buildScheduleEntries,readBumpers,safeRebuildBoundary,preserveEpgIdentities} from '../dist/src/schedule.js';
import {readRotationLibrary} from '../dist/src/intermissions/rotation.js';
import {auditSchedule} from '../dist/src/schedule-audit.js';
import {ageEligible} from '../dist/src/children-policy.js';
import {eligibleFor} from '../dist/src/channels.js';
import {writeEpgAtomic} from '../dist/src/epg.js';

const apply=process.argv.includes('--apply');
const reportFile=path.resolve(process.env.LKP_REBUILD_REPORT??'runtime/schedule-rebuild.status.json');
fs.mkdirSync(path.dirname(reportFile),{recursive:true});
const began=performance.now();
const report=(phase,extra={})=>{const value={phase,pid:process.pid,updatedAt:new Date().toISOString(),elapsedSeconds:Math.round((performance.now()-began)/100)/10,...extra};fs.writeFileSync(reportFile+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(reportFile+'.tmp',reportFile);console.log(JSON.stringify(value));};
const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
let db;
try{
 const config=loadConfig();
 if(!config.children?.enabled||!config.station?.enabled)throw new Error('Enabled station and children policies required');
 db=Object.create(LkpDatabase.prototype);Object.defineProperty(db,'db',{value:new Database(config.storage.database,{readonly:true,fileMustExist:true})});
 const settings=db.db.prepare('SELECT target_age,tolerance FROM children_settings WHERE id=1').get();
 Object.assign(config.children,{targetAgeYears:settings.target_age,ageToleranceYears:settings.tolerance});
 const bounds=db.scheduleBounds();if(!bounds)throw new Error('No existing timetable');
 const boundary=safeRebuildBoundary(db,Date.now()+10*60_000);if(!boundary)throw new Error('No safe future programme boundary');
 const start=boundary.startsAtMs;
 const end=DateTime.fromMillis(bounds.lastMs,{zone:config.channel.timezone}).set({hour:6,minute:0,second:0,millisecond:0}).toMillis();
 if(end<=start)throw new Error('Schedule horizon is too short');
 const prefix=db.listSchedule(bounds.firstMs,start),future=db.listSchedule(start,bounds.lastMs+1);
 const original=db.db.prepare('SELECT * FROM schedule_entries WHERE sequence>=? ORDER BY sequence').all(boundary.sequence),expected=hash(original);
 const catalogue=db.listMedia();
 const planning={config,ads:db.listAds(),clips:readRotationLibrary(config),bumpers:readBumpers(config),reserved:future.filter(e=>e.showId==='lkp-weather'),history:db.db.prepare('SELECT media_id AS mediaId,played_count AS count,last_played_at_ms AS lastAtMs FROM media_rotation_history').all(),onProgress:p=>report('planning',{...p,percent:Math.min(100,Math.round(p.completedDays/p.totalDays*100)),effectiveAt:new Date(start).toISOString()})};
 report('planning',{effectiveAt:new Date(start).toISOString()});
 const planStarted=performance.now();
 const rows=buildScheduleEntries(catalogue,config.schedule.seed,start,end,boundary.sequence,prefix,planning);
 const planningSeconds=(performance.now()-planStarted)/1000;
 preserveEpgIdentities(rows,planning.reserved,prefix);
 const quality=auditSchedule(rows,catalogue,config);
 if(prefix.at(-1)?.endsAtMs!==rows[0]?.startsAtMs)quality.errors.push('Historical prefix does not join the replacement');
 const week=rows.filter(e=>e.startsAtMs<start+7*86400000),weekly=auditSchedule(week,catalogue,config);
 const represented=new Set(week.flatMap(e=>e.playoutPlan?.assembly?.sources??[]).map(s=>catalogue.find(m=>m.id===s.mediaId)?.showId));
 const eligibleShows=[...new Set(catalogue.filter(m=>ageEligible(m,config.children)&&eligibleFor(m,'lkp',config.station,start)&&fs.existsSync(m.mediaPath)).map(m=>m.showId))];
 const missing=eligibleShows.filter(id=>!represented.has(id));
 if(missing.length)quality.errors.push('Eligible shows missing next week: '+missing.join(', '));
 for(const [language,target] of Object.entries(config.schedule.spokenLanguageTargets??{})){const actual=weekly.metrics.spokenShares[language]??0;if(Math.abs(actual-target*100)>4)quality.errors.push('Weekly spoken language imbalance: '+language);}
 if(quality.errors.length)throw new Error(quality.errors.slice(0,5).join('; '));
 const summary={planningSeconds,events:rows.length,effectiveAt:new Date(start).toISOString(),until:new Date(end).toISOString(),age:settings.target_age,metrics:quality.metrics,nextWeek:weekly.metrics,eligibleShows};
 report('validated',summary);
 if(apply){
  if(start<Date.now()+60_000)throw new Error('Planning boundary expired; rerun safely');
  const backup=reportFile.replace(/\.json$/, '')+'.before.sqlite';
  if(fs.existsSync(backup))throw new Error('Backup path already exists; use a new report filename');
  await db.db.backup(backup);fs.chmodSync(backup,0o600);db.close();
  db=new LkpDatabase(config.storage.database);childrenSettings(db,config);
  report('applying',{...summary,backup});
  db.db.transaction(()=>{
   if(start<Date.now()+60_000)throw new Error('Planning boundary expired before commit');
   const actual=db.db.prepare('SELECT * FROM schedule_entries WHERE sequence>=? ORDER BY sequence').all(boundary.sequence);
   if(hash(actual)!==expected)throw new Error('Concurrent timetable update; existing schedule retained');
   db.db.prepare('DELETE FROM schedule_entries WHERE sequence>=?').run(boundary.sequence);
   saveChildrenAge(db,settings.target_age,settings.tolerance,start);db.insertSchedule(rows);
  }).immediate();
  const saved=db.listSchedule(start,end+1);const check=auditSchedule(saved,catalogue,config);if(check.errors.length)throw new Error('Post-commit audit failed: '+check.errors.slice(0,3).join('; '));
  writeEpgAtomic(db.listSchedule(Date.now()-86400000,Date.now()+config.schedule.epgDays*86400000),config);
  report('completed',{...summary,backup,epg:config.epg.output});
 }else report('preview-completed',summary);
}catch(error){report('failed',{error:error.message});process.exitCode=1;}finally{db?.close();}
