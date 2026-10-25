// Read-only catalogue access. This never migrates SQLite or commits a schedule.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import { loadConfig } from '../src/config.js';
import { LkpDatabase } from '../src/database.js';
import { readBumpers, buildScheduleEntries, validateTimeline } from '../src/schedule.js';
import { readRotationLibrary } from '../src/intermissions/rotation.js';
const [date='2026-10-26', output='/tmp/lkp-schedule-examples'] = process.argv.slice(2);
const app=loadConfig();
if(!app.children) throw new Error('Children policy is missing');
const db=Object.create(LkpDatabase.prototype) as LkpDatabase;
Object.defineProperty(db,'db',{value:new Database(app.storage.database,{readonly:true,fileMustExist:true})});
try {
  const media=db.listMedia();
  fs.mkdirSync(output,{recursive:true});
  const from=DateTime.fromISO(date,{zone:app.channel.timezone}).startOf('day');
  if(!from.isValid) throw new Error('Invalid example date');
  for(const age of [3,6]) {
    app.children={...app.children,targetAgeYears:age};
    // Include yesterday so requested next-day repeats resolve to exact original source blocks.
    const rows=buildScheduleEntries(media,app.schedule.seed,from.minus({days:1}).set({hour:6}).toMillis(),from.plus({days:1}).set({hour:6}).toMillis(),0,[],{config:app,ads:db.listAds(),clips:readRotationLibrary(app),bumpers:readBumpers(app)});
    const errors=validateTimeline(rows);if(errors.length)throw new Error(errors.join('; '));
    const day=rows.filter(e=>e.startsAtMs>=from.set({hour:6}).toMillis() && e.startsAtMs<from.set({hour:from.weekday>=6?21:20}).toMillis());
    const clock=(n:number)=>DateTime.fromMillis(n,{zone:app.channel.timezone}).toFormat('HH:mm:ss');
    const escape=(s:string)=>s.replaceAll('|','/').replaceAll('\n',' ');
    const lines=[`# LKP ${date} · target age ${age}`, '', 'Generated from the available Pi catalogue; preview only. Europe/Prague. Editorial tolerance: 1 year. Programme anchors may drift by up to 5 seconds; no scheduled holding screens.', '', '| Start | End | Programme | Episodes / sources |', '| --- | --- | --- | --- |',...day.map(e=>`| ${clock(e.startsAtMs)} | ${clock(e.endsAtMs)} | ${escape(e.showTitle)} | ${escape(e.episodeTitle)}${e.playoutPlan?.assembly?.rerunOf?' (yesterday’s exact block)':''} |`),''];
    fs.writeFileSync(path.join(output,`age-${age}-${date}.md`),lines.join('\n'));
    fs.writeFileSync(path.join(output,`age-${age}-${date}.json`),JSON.stringify(day,null,2));
    console.log(`Age ${age}: ${day.length} daytime events; timeline validated.`);
  }
}finally{db.close();}
