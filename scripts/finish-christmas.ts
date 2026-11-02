// Explicit production operation. Run detached with node --import tsx; it never
// requests speech, starts playout, or rewrites the live timetable.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {readFilms,outputRoot} from '../src/intermissions/render.js';
import {isCurrentRender} from '../src/intermissions/revision.js';
import {loadConfig} from '../src/config.js';
import {liveLeaseOwner} from '../src/acquisition/io.js';

const ids=['16-christmas-presents','17-christmas-fireplace','18-christmas-letters','19-christmas-map'];
const scopes=['src','test','scripts','skills','assets/christmas','README.md','INTERMISSIONS.md','CHILDREN-SCHEDULING.md','package.json','package-lock.json','tsconfig.json'];
const root=process.cwd(),tracking=path.resolve('runtime/christmas-production');
if(process.argv.includes('--help')) {
  console.log('Run from the Pi checkout: node --import tsx scripts/finish-christmas.ts\nTracking: runtime/christmas-production/latest.json');
  process.exit(0);
}
if(root!=='/home/lundenburg/lundenburg')throw new Error('Run from the maintained Pi checkout');
fs.mkdirSync(tracking,{recursive:true});
const lock=path.join(tracking,'lock.json');
if(fs.existsSync(lock)) {
  const previous=JSON.parse(fs.readFileSync(lock,'utf8'));
  let live=false;try{process.kill(previous.pid,0);live=true;}catch{}
  if(live)throw new Error('A Christmas production job is already running');
  fs.rmSync(lock);
}
const jobId=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
const job=path.join(tracking,jobId);fs.mkdirSync(job,{recursive:true});
fs.writeFileSync(lock,JSON.stringify({pid:process.pid,jobId}),{flag:'wx'});
const state:Record<string,unknown>={jobId,pid:process.pid,state:'running',phase:'starting',startedAt:new Date().toISOString(),outputRoot,newSpeechRequests:0,completedStages:[],pendingRequirements:['PC checkout is not reachable from this Pi; PC synchronization remains unverified.']};
const report=()=>{state.updatedAt=new Date().toISOString();for(const file of [path.join(job,'status.json'),path.join(tracking,'latest.json')]){fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2)+'\n');fs.renameSync(file+'.tmp',file);}};
const heartbeat=setInterval(report,15000);report();
const git=(args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const filenames=(directory:string):string[]=>fs.statSync(directory).isDirectory()?fs.readdirSync(directory).flatMap(n=>filenames(path.join(directory,n))):[directory];
const featureManifest=()=>Object.fromEntries(scopes.flatMap(p=>fs.existsSync(p)?filenames(p):[]).sort().map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const source=featureManifest(),sourceJson=JSON.stringify(source);
fs.writeFileSync(path.join(job,'source-files.json'),JSON.stringify(source,null,2));
const assertSource=()=>{if(JSON.stringify(featureManifest())!==sourceJson)throw new Error('Source changed during production; finished assets retained for review, publication stopped.');};
const changed=Array.from(new Set([...git(['diff','--name-only','HEAD','--',...scopes]).split('\n'),...git(['ls-files','--others','--exclude-standard','--',...scopes]).split('\n')].filter(Boolean)));
const finishStage=()=>{(state.completedStages as string[]).push(String(state.phase));report();};
const phase=(name:string)=>{state.phase=name;report();console.log(`[${new Date().toISOString()}] ${name}`);};
let currentChild:ReturnType<typeof spawn>|undefined;
async function run(name:string,binary:string,args:string[],cwd=root,quiet=false) {
  phase(name);const file=path.join(job,`${name}.log`),fd=fs.openSync(file,'a');
  try{await new Promise<void>((resolve,reject)=>{
    currentChild=spawn(binary,args,{cwd,env:{...process.env,INTERMISSION_CONCURRENCY:'1',LKP_ACQUISITION_RELEASE:root},stdio:quiet?['ignore','ignore','ignore']:['ignore',fd,fd]});
    currentChild.once('error',()=>reject(new Error(`${name}: could not start`)));
    currentChild.once('exit',(code,signal)=>{currentChild=undefined;code===0?resolve():reject(new Error(`${name}: ${signal??`exit ${code}`}; see stage log`));});
  });finishStage();}finally{fs.closeSync(fd);}
}
const cli=(name:string,args:string[])=>run(name,process.execPath,['--import','tsx','src/intermissions/cli.ts',...args]);
const warning=(message:string)=>{(state.pendingRequirements as string[]).push(message);report();};
const syncScopes=['src','test','scripts','skills','assets/christmas','README.md','INTERMISSIONS.md','CHILDREN-SCHEDULING.md','package.json','package-lock.json','tsconfig.json'];
async function synchronize(destination:string,label:string) {
  phase(`synchronize-${label}`);
  const backup=path.join(job,`backup-${label}`);fs.mkdirSync(backup,{recursive:true});
  for(const relative of syncScopes) {
    const from=path.join(root,relative),to=path.join(destination,relative);
    if(fs.existsSync(to))fs.cpSync(to,path.join(backup,relative),{recursive:true,verbatimSymlinks:true});
    fs.mkdirSync(path.dirname(to),{recursive:true});fs.cpSync(from,to,{recursive:true});
  }
  // Do not copy configuration, credentials, databases, or overwrite media/cache.
  const copies=featureManifest();for(const [relative,hash]of Object.entries(copies)) {
    if(createHash('sha256').update(fs.readFileSync(path.join(destination,relative))).digest('hex')!==hash)throw new Error(`${label}: source verification failed`);
  }
  fs.writeFileSync(path.join(job,`${label}-source-files.json`),JSON.stringify(copies,null,2));finishStage();
}
process.on('SIGTERM',()=>{currentChild?.kill('SIGTERM');state.state='interrupted';report();process.exit(1);});
try {
  await run('tests','npm',['test']);assertSource();
  await cli('cached-preparation',['prepare','--audio','cache','--id',...ids]);
  const films=readFilms(ids);state.durationSeconds=films.reduce((n,f)=>n+f.durationInFrames/f.fps,0);report();
  const fresh=films.filter(f=>!isCurrentRender(f,outputRoot)).map(f=>f.skit.id);
  const posters=films.filter(f=>fresh.includes(f.skit.id)||!fs.existsSync(path.join(outputRoot,'stills',`${f.skit.id}-2.png`))).map(f=>f.skit.id);
  if(posters.length)await cli('browser-stills',['render','--stills','--scale','1','--id',...posters]);
  await cli('masters',['render','--skip-existing','--id',...ids]);assertSource();
  if(films.some(f=>!isCurrentRender(f,outputRoot)))throw new Error('A current final master is missing');
  phase('gallery-assets');
  for(const file of fs.readdirSync(path.join(outputRoot,'manifests')).filter(f=>f.endsWith('.json')&&!f.includes('.preview'))) {
    const to=path.join(root,'runtime/intermissions/manifests',file);if(!fs.existsSync(to))fs.copyFileSync(path.join(outputRoot,'manifests',file),to);
  }
  for(const id of ids) {
    fs.copyFileSync(path.join(root,'runtime/intermissions/manifests',`${id}.json`),path.join(outputRoot,'manifests',`${id}.json`));
    fs.copyFileSync(path.join(root,'runtime/intermissions/review',`${id}-sheet.png`),path.join(outputRoot,'stills',`${id}-review.png`));
  }
  fs.copyFileSync('runtime/christmas-redesign/jeschischek-refined-fit.png',path.join(outputRoot,'stills','jeschischek-approved.png'));
  finishStage();await cli('gallery',['gallery']);state.mediaReady=true;report();
  assertSource();
  await synchronize('/home/lundenburg/lkp-weather','weather');
  await run('weather-installation',process.execPath,['scripts/verify-weather-installation.mjs'],'/home/lundenburg/lkp-weather');
  await synchronize('/home/lundenburg/lkp-intermissions','intermissions');
  phase('shared-speech-cache');
  for(const film of films)for(const cue of film.cues) {
    const relative=path.dirname(cue.asset.audio);
    if(!/^speech\/[a-f0-9]{64}$/.test(relative))throw new Error('Unexpected speech cache reference');
    const target=path.join('/home/lundenburg/lkp-weather/runtime/weather/public',relative);
    fs.mkdirSync(target,{recursive:true});fs.cpSync(path.join(root,'runtime/weather/public',relative),target,{recursive:true,force:false,errorOnExist:false});
  }
  for(const id of ids)fs.copyFileSync(path.join(root,'runtime/intermissions/manifests',`${id}.json`),path.join('/home/lundenburg/lkp-intermissions/runtime/intermissions/manifests',`${id}.json`));
  finishStage();
  const current='/home/lundenburg/lkp-content/current',baseline=fs.realpathSync(current),prepared=path.join(job,'prepared-release');
  const config=loadConfig(),db=new Database(config.storage.database,{readonly:true,fileMustExist:true});
  const priorLease=db.prepare('SELECT owner,expires FROM acquisition_lock WHERE id=1').get() as {owner:string;expires:number}|undefined;db.close();
  await run('prepare-release',process.execPath,['scripts/prepare-content-release.mjs',baseline,prepared]);
  assertSource();
  await run('activate-release',process.execPath,['scripts/activate-content-release.mjs',prepared,`/home/lundenburg/lkp-content/releases/${jobId}-christmas`,'--after-current-batch','--preserve-publication-policy']);
  // A worker already in flight retains the old immutable code. Let it finish
  // before exposing seasonal entries to its library reader.
  phase('previous-worker-boundary');const until=Date.now()+2*60*60*1000;
  while(liveLeaseOwner(priorLease)) {if(Date.now()>until)throw new Error('Previous acquisition worker is still active; publication deferred.');await new Promise(r=>setTimeout(r,5000));}
  finishStage();assertSource();await cli('publication',['publish','--id',...ids]);state.published=true;report();
  await run('schedule-preview',process.execPath,['--import','tsx','scripts/preview-christmas-schedule.ts']);
  phase('source-synchronization');assertSource();
  if(git(['diff','--cached','--name-only']))warning('Source is synchronized on the Pi, but a pre-existing staged change prevented automatic commit/push.');
  else if(changed.length) {
    try {
      git(['diff','--check']);git(['add','--',...changed]);git(['commit','-m','Add Jeschischek and annually available Christmas intermissions']);
      state.sourceCommit=git(['rev-parse','HEAD']);
      await run('source-push','git',['push','origin','HEAD:main'],root,true);state.remoteSynchronized=true;
    }catch{warning('Source commit/push needs follow-up; local source and production backups are preserved.');}
  }
  finishStage();
  await run('service-health','systemctl',['show','lkp.service','lkp-content.service','lkp-weather.service','--property=Id,ActiveState,SubState,MainPID']);
  state.state='finished';state.phase='finished';state.finishedAt=new Date().toISOString();report();
  console.log(`Finished. Gallery: ${path.join(outputRoot,'index.html')}`);
} catch(error) {
  state.state='failed';state.error=error instanceof Error?error.message:'Production failed';state.finishedAt=new Date().toISOString();report();console.error(String(state.error));process.exitCode=1;
} finally {clearInterval(heartbeat);fs.rmSync(lock,{force:true});}
