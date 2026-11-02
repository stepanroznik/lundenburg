// Read-only planning preview, using the real published library and catalogue.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {DateTime} from 'luxon';
import {loadConfig} from '../src/config.js';
import {LkpDatabase} from '../src/database.js';
import {buildScheduleEntries,readBumpers,validateTimeline} from '../src/schedule.js';
import {readRotationLibrary} from '../src/intermissions/rotation.js';
const dates=process.argv.slice(2);
if(!dates.length)dates.push('2026-12-01','2026-12-25','2026-12-26');
const app=loadConfig(),db=Object.create(LkpDatabase.prototype) as LkpDatabase;
Object.defineProperty(db,'db',{value:new Database(app.storage.database,{readonly:true,fileMustExist:true})});
try {
  if(!app.children?.enabled||!app.station?.enabled)throw new Error('Expected the existing station/children planner');
  const settings=db.db.prepare('SELECT target_age,tolerance FROM children_settings WHERE id=1').get() as {target_age:number;tolerance:number}|undefined;
  if(settings)Object.assign(app.children,{targetAgeYears:settings.target_age,ageToleranceYears:settings.tolerance});
  const media=db.listMedia(),clips=readRotationLibrary(app),ads=db.listAds(),bumpers=readBumpers(app),report=[];
  for(const date of dates) {
    const day=DateTime.fromISO(date,{zone:'Europe/Prague'}).set({hour:6});
    if(!day.isValid)throw new Error('Invalid preview date');
    const rows=buildScheduleEntries(media,app.schedule.seed,day.toMillis(),day.plus({days:1}).toMillis(),0,[],{config:app,clips,ads,bumpers});
    const errors=validateTimeline(rows);if(errors.length)throw new Error(errors.join('; '));
    const christmas=rows.filter(e=>e.playoutPlan?.segments.some(s=>s.type==='intermission'&&s.availability==='christmas'));
    const summary={date,events:rows.length,christmas:christmas.map(e=>({id:e.mediaId,at:DateTime.fromMillis(e.startsAtMs,{zone:'Europe/Prague'}).toFormat('HH:mm:ss'),seconds:e.durationMs/1000}))};
    report.push(summary);console.log(JSON.stringify(summary));
  }
  fs.mkdirSync('runtime/christmas',{recursive:true});fs.writeFileSync(path.resolve('runtime/christmas/schedule-preview.json'),JSON.stringify({preview:true,timezone:'Europe/Prague',dates:report},null,2));
}finally{db.close();}
