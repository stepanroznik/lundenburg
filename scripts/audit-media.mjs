#!/usr/bin/env node
// Read-only media inventory. Unreferenced files remain review candidates:
// archives, retained downloads and manually used media are not disposable.
import fs from 'node:fs';
import path from 'node:path';
import {loadConfig} from '../src/config.ts';
import {LkpDatabase} from '../src/database.ts';
import {assertMediaStorage} from '../src/media-storage.ts';

const app=loadConfig();assertMediaStorage(app);
const catalogue=new LkpDatabase(app.storage.database,{readonly:true}),db=catalogue.db;
const references=new Set(),future=new Set();
const add=(value,into=references)=>{
  if(typeof value==='string'&&path.isAbsolute(value)){into.add(path.resolve(value));return;}
  if(value&&typeof value==='object')for(const child of Object.values(value))add(child,into);
};
let integrity,catalogueFiles=0,missingEnabled=[];
try {
  integrity=db.pragma('quick_check',{simple:true});
  db.transaction(()=>{
    for(const row of db.prepare('SELECT media_path,enabled FROM media_items').iterate()){
      add(row.media_path);catalogueFiles++;
      if(row.enabled&&!fs.existsSync(row.media_path))missingEnabled.push(row.media_path);
    }
    for(const row of db.prepare('SELECT path FROM media_assets').iterate())add(row.path);
    for(const row of db.prepare('SELECT media_path FROM ad_assets').iterate())add(row.media_path);
    for(const row of db.prepare('SELECT media_path,playout_plan_json,ends_at_ms FROM schedule_entries').iterate()){
      add(row.media_path);if(row.ends_at_ms>Date.now())add(row.media_path,future);
      if(row.playout_plan_json){const plan=JSON.parse(row.playout_plan_json);add(plan);if(row.ends_at_ms>Date.now())add(plan,future);}
    }
  })();
} finally {catalogue.close();}
for(const file of [app.station?.assetManifest,app.intermissions?.manifest,app.advertising?.bumperManifest].filter(Boolean)){
  if(fs.existsSync(file))add(JSON.parse(fs.readFileSync(file,'utf8')));
}
const groups={},candidates=[];let scannedFiles=0,symlinksSkipped=0,totalBytes=0;
async function walk(root){
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    const file=path.join(root,entry.name);
    if(entry.isSymbolicLink()){symlinksSkipped++;continue;}
    if(entry.isDirectory()){await walk(file);continue;}
    if(!entry.isFile())continue;
    let stat;try{stat=fs.statSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    scannedFiles++;totalBytes+=stat.size;
    if(scannedFiles%200===0)await new Promise(resolve=>setImmediate(resolve));
    if(!/\.(?:mp4|mkv|mov|webm|ts|wav|mp3|ogg|opus)(?:\.part)?$/i.test(file)||references.has(file))continue;
    const relative=path.relative(app.media.root,file);
    const group=relative.split(path.sep).slice(0,relative.startsWith('.')?2:1).join('/');
    const bucket=groups[group]??={files:0,bytes:0};bucket.files++;bucket.bytes+=stat.size;
    if(candidates.length<50)candidates.push({file,bytes:stat.size});
  }
}
await walk(app.media.root);
const report={generatedAt:new Date().toISOString(),readOnly:true,integrity,catalogueFiles,missingEnabled,
  missingFutureReferences:[...future].filter(file=>!fs.existsSync(file)),scannedFiles,totalBytes,symlinksSkipped,
  unreferencedMediaGroups:groups,reviewCandidates:candidates,
  note:'Reference absence does not establish that deletion is safe. Archives, staging and manually used files are retained.'};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,reviewCandidates:undefined,missingEnabledCount:missingEnabled.length,missingFutureReferenceCount:report.missingFutureReferences.length,missingEnabled:undefined,missingFutureReferences:undefined}));
