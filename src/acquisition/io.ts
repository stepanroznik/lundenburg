import type { AppConfig } from '../types.js';
import type { AcquisitionConfig } from './model.js';
import type { LkpDatabase } from '../database.js';
import fs from 'node:fs';
import { downloaderFailure } from './adapters.js';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { assertMediaStorage } from '../media-storage.js';
import { readPlayoutStatus } from '../playout-status.js';
const childGroups=new Set<number>();
export function terminateChildren():void {for(const pid of childGroups){try{process.kill(-pid,'SIGKILL');}catch{}}}
export class Deferred extends Error {
}
export class Quarantined extends Error {
}
export class DownloadHttpError extends Error {

    constructor(readonly status:number){super(`Download HTTP ${status}`);}
}
export function failureCode(error:unknown):string {
  const code=(error as {code?:unknown}|null)?.code;
  const allowed=['EACCES','EPERM','EROFS','ENOSPC','ENOENT','EBUSY','EMFILE','SQLITE_BUSY','SQLITE_READONLY','SQLITE_READONLY_DBMOVED','SQLITE_CANTOPEN','SQLITE_FULL','SQLITE_CORRUPT','MEDIA_ROOT_MISSING','MEDIA_MOUNT_MISSING','MEDIA_MOUNT_MISMATCH'];
  return typeof code==='string'&&allowed.includes(code)?code:'UNEXPECTED';
}
export function signature(file:string): {size:number;mtime:number} { const s=fs.statSync(file); return {size:s.size,mtime:s.mtimeMs}; }
export function sameSignature(a:{size:number;mtime:number},b:{size:number;mtime:number}): boolean {return a.size===b.size&&a.mtime===b.mtime;}
export function reserve(root:string,required:number,minFree:number): void {
  const stat=fs.statfsSync(root);const free=stat.bavail*stat.bsize;
  if(!Number.isFinite(required)||required<0||free-required<minFree)throw new Deferred('Minimum disk-space reserve would be breached');
}
export function processAlive(pid:number,updatedAt:number):boolean {
  if(!Number.isSafeInteger(pid)||pid<=0)return true;
  try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;}
  // Compare Linux process birth with the heartbeat to detect a reused PID.
  try {
    const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
    const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
    const startTicks=Number(fields[19]),uptime=Number(fs.readFileSync('/proc/uptime','utf8').split(' ')[0]);
    // Linux exports process times in USER_HZ (100 ticks/second).
    const startedAt=Date.now()-uptime*1000+startTicks*10;
    if(startedAt>updatedAt+1000)return false;
  }catch{} // Unknown liveness is treated conservatively as active.
  return true;
}
export class BroadcastGuard {




    constructor(private app:AppConfig,private db:LkpDatabase,private policy:AcquisitionConfig,private deadline:number) {}
    check(file?:string):void {
    if(Date.now()>this.deadline)throw new Deferred('Run time budget reached');
    assertMediaStorage(this.app);
    const status=readPlayoutStatus(path.join(this.app.storage.runtimeDirectory,'playout-status.json'));
    if(status?.state==='running' && processAlive(status.pid,status.updatedAtMs) && (status.stale || status.leadMs < -5000 || (status.next && !status.next.ready)))throw new Deferred('Playout is stale, behind, or awaiting its next asset');
    if(!file)return;
    const now=Date.now();
    const active=this.db.db.prepare("SELECT schedule_entry_id FROM playback_log WHERE status='started' AND actual_end_ms IS NULL ORDER BY actual_start_ms DESC LIMIT 3").all() as Array<{schedule_entry_id:string}>;
    const protectedIds=new Set([...(status?.state==='running'&&processAlive(status.pid,status.updatedAtMs)?[status.current?.scheduleEntryId,status.next?.scheduleEntryId]:[]),...active.map(r=>r.schedule_entry_id)].filter(Boolean));
    const entries=this.db.listSchedule(now-this.policy.scheduleGuardSeconds*1000,now+this.policy.scheduleGuardSeconds*1000);
    for(const id of protectedIds) {const row=this.db.db.prepare('SELECT starts_at_ms,ends_at_ms FROM schedule_entries WHERE id=?').get(id) as {starts_at_ms:number;ends_at_ms:number}|undefined;if(row)entries.push(...this.db.listSchedule(row.starts_at_ms,row.ends_at_ms));}
    const paths=entries.flatMap(e=>[e.mediaPath,...(e.playoutPlan?.segments.map(s=>s.mediaPath)??[])]);
    if(paths.includes(file))throw new Deferred('Asset is playing or inside the protected playout window');
  }
}
export async function execute(binary:string, args:string[], guard?:()=>void, timeout=60_000) : Promise<string> {
    guard?.();
    return new Promise((resolve, reject) => {
        // The service cgroup also limits all descendants; these controls apply to CLI use.
        const child = spawn('nice', ['-n', '19', 'ionice', '-c', '3', binary, ...args], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
        if (child.pid)
            childGroups.add(child.pid);
        const kill = () => { if (child.pid) {
            try {
                process.kill(-child.pid, 'SIGKILL');
            }
            catch {
                child.kill('SIGKILL');
            }
        } };
        let stdout = '', stderr = '', size = 0, failed: Error|undefined;
        child.stdout.setEncoding('utf8').on('data', (chunk:string) => { size += chunk.length; if (size > 16 * 1024 * 1024) {
            failed = new Error('Command output limit exceeded');
            kill();
        }
        else
            stdout += chunk; });
        // Never print provider stderr: it can contain signed URLs or secrets.
        child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-65536); });
        const timer = timeout > 0 ? setTimeout(() => { failed = new Deferred(`${path.basename(binary)} timed out`); kill(); }, timeout) : undefined;
        const watch = setInterval(() => { try {
            guard?.();
        }
        catch (e) {
            failed = e instanceof Error ? e : new Error(String(e));
            kill();
        } }, 1000);
        child.on('error', () => { clearTimeout(timer); clearInterval(watch); reject(new Error(`${path.basename(binary)} could not start`)); });
        child.on('close', (code) => { if (child.pid)
            childGroups.delete(child.pid); clearTimeout(timer); clearInterval(watch); if (failed)
            reject(failed);
        else if (code !== 0)
            reject(path.basename(binary) === 'yt-dlp' ? downloaderFailure(stderr) : new Error(`${path.basename(binary)} failed (${code})`));
        else
            resolve(stdout); });
    });
}
export async function download(url:string,partial:string,maxBytes:number,policy:AcquisitionConfig,guard:()=>void):Promise<void> {
  if(new URL(url).protocol!=='https:')throw new Quarantined('Only HTTPS source downloads are admitted');
  guard();reserve(path.dirname(partial),maxBytes,policy.reserveBytes);
  const validatorFile=`${partial}.resume.json`;
  let saved:{etag?:string;url?:string}={};try{saved=JSON.parse(fs.readFileSync(validatorFile,'utf8'));}catch{}
  let offset=fs.existsSync(partial)?signature(partial).size:0;
  if(!saved.etag||saved.url!==url){offset=0;fs.writeFileSync(partial,'');}
  // Connection and idle-read deadlines are independent of batch elapsed time.
  // The idle timer runs only while awaiting the network, not during rate limiting.
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const arm=(seconds:number,reason:string)=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(new Deferred(reason)),seconds*1000);};
  const watch=setInterval(()=>{try{guard();}catch(error){controller.abort(error);}},1000);
  let fd:fs.promises.FileHandle|undefined;
  try {
    arm(policy.connectTimeoutSeconds,'Download connection timed out');
    const response=await fetch(url,{headers:offset?{Range:`bytes=${offset}-`,'If-Range':saved.etag!}:{},signal:controller.signal});
    clearTimeout(timer);
    if(!response.ok||!response.body){await response.body?.cancel();throw new DownloadHttpError(response.status);}
    if(offset && (response.status!==206 || !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`))) {
      if(response.status!==200){await response.body.cancel();throw new Error('Invalid range response');}offset=0;
    }
    const length=Number(response.headers.get('content-length'));
    if(length>0 && offset+length>maxBytes){await response.body.cancel();throw new Quarantined('Source exceeds admitted byte budget');}
    fs.writeFileSync(validatorFile,JSON.stringify({etag:response.headers.get('etag'),url}),{mode:0o600});
    fd=await fs.promises.open(partial,offset?'a':'w');let size=offset,received=0;const start=Date.now();
    const reader=response.body.getReader();
    // Also cancel mocked/custom streams, which may not observe fetch's signal.
    const cancel=()=>{void reader.cancel().catch(()=>{});};
    controller.signal.addEventListener('abort',cancel,{once:true});
    try {
      for(;;) {
        arm(policy.downloadStallSeconds,'Download stalled; retry scheduled');
        const {done,value:chunk}=await reader.read();clearTimeout(timer);
        controller.signal.throwIfAborted();if(done)break;
        guard();size+=chunk.length;received+=chunk.length;
        if(size>maxBytes)throw new Quarantined('Download exceeded admitted byte budget');
        reserve(path.dirname(partial),chunk.length,policy.reserveBytes);
        await fd.write(chunk);
        let wait=received/policy.downloadBytesPerSecond*1000-(Date.now()-start);
        while(wait>0){await delay(Math.min(wait,1000));controller.signal.throwIfAborted();guard();wait=received/policy.downloadBytesPerSecond*1000-(Date.now()-start);}
      }
    }finally{controller.signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});}
    await fd.sync();
    if(length>0 && size!==offset+length)throw new Error('Truncated HTTP download');
  }catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw error;}
  finally{clearTimeout(timer);clearInterval(watch);await fd?.close();}
}
// Progress watchdog for external downloaders. Ignore metadata files and count
// growing media/fragment files; an idle subprocess cannot monopolize the worker.
export function progressWatch(bytes:()=>number,stallSeconds:number,now=Date.now):()=>void {
  let previous=bytes(),lastProgress=now();
  return ()=>{const current=bytes(),time=now();if(current!==previous){previous=current;lastProgress=time;}
    else if(time-lastProgress>=stallSeconds*1000)throw new Deferred('Media processing stalled; retry scheduled');};
}
