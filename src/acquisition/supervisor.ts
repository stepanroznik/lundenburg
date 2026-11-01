import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';

const phases = new Set(['starting','recovering','indexing','discovering','classifying','incoming','enriching','acquiring','publishing','finishing']);
let phase = 'starting';
export function workerPhase(value:string):void {
  if (phases.has(value)) phase = value;
  if (process.connected) process.send?.({type:'heartbeat',phase});
}
export function startWorkerHeartbeat():void {
  workerPhase('starting');
  setInterval(()=>workerPhase(phase),5000).unref();
}

/** The parent stays responsive even when a worker blocks its JS event loop. */
export async function superviseBatch(entrypoint:string,args:string[],statusFile:string,
  options:{stallMs?:number;pollMs?:number;stopGraceMs?:number}={}):Promise<number> {
  // Provider subprocesses have independent 120s timeouts; leave enough room
  // for them to fail and clean up before treating the worker itself as stuck.
  const stallMs=options.stallMs??180_000, pollMs=options.pollMs??5000, grace=options.stopGraceMs??5000;
  fs.mkdirSync(path.dirname(statusFile),{recursive:true,mode:0o700});
  const child=fork(entrypoint,args,{env:{...process.env,LKP_ACQUISITION_WORKER:'1'},stdio:['ignore','inherit','inherit','ipc'],detached:true});
  const groups=new Set<number>();
  let heartbeat=Date.now(),activity='running',stage='starting',stopping=false,finished=false;
  let escalation:ReturnType<typeof setTimeout>|undefined;
  const save=()=>{
    const temporary=`${statusFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary,JSON.stringify({activity,phase:stage,supervisorPid:process.pid,workerPid:child.pid,
      heartbeatAtMs:heartbeat,updatedAtMs:Date.now()})+'\n',{mode:0o600});
    fs.renameSync(temporary,statusFile);
  };
  const killGroups=()=>{for(const pid of groups)try{process.kill(-pid,'SIGKILL');}catch{}};
  const stop=()=>{
    if(stopping)return;stopping=true;killGroups();child.kill('SIGTERM');
    escalation=setTimeout(()=>{killGroups();child.kill('SIGKILL');},grace);
  };
  const onSignal=()=>{activity='stopping';save();stop();};
  process.on('SIGTERM',onSignal);process.on('SIGINT',onSignal);
  child.on('message',(message:unknown)=>{
    const m=message as {type?:string;phase?:string;pid?:number;active?:boolean};
    if(m?.type==='heartbeat'){
      heartbeat=Date.now();if(m.phase&&phases.has(m.phase))stage=m.phase;
      if(!stopping)save();
    } else if(m?.type==='child-group'&&Number.isSafeInteger(m.pid)&&m.pid!>0){
      if(m.active){groups.add(m.pid!);if(stopping)killGroups();}else groups.delete(m.pid!);
    }
  });
  save();
  const poll=setInterval(()=>{
    if(!stopping&&Date.now()-heartbeat>stallMs){activity='stalled';save();stop();}
  },pollMs);
  return new Promise(resolve=>{
    const finish=(code:number)=>{
      if(finished)return;finished=true;
      clearInterval(poll);clearTimeout(escalation);killGroups();
      process.off('SIGTERM',onSignal);process.off('SIGINT',onSignal);
      if(activity==='running')activity=code===0?'completed':'failed';
      save();resolve(code);
    };
    child.once('error',()=>finish(1));
    child.once('exit',(code)=>finish(stopping?1:code??1));
  });
}
