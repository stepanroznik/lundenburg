import { Worker } from 'node:worker_threads';
import type { AppConfig } from '../types.js';
import { Deferred, failureCode } from './io.js';
import type { AcquisitionConfig } from './model.js';

export class PublicationFailure extends Deferred {
  constructor(readonly stage:string,readonly code:string) {super(`Schedule publication failed at ${stage} (${code})`);}
}

/** Keep operational diagnosis useful without persisting arbitrary error text. */
export function publicationFailureSummary(error:unknown):string {
  if(error instanceof PublicationFailure)return error.message;
  if(error instanceof Deferred) {
    const message=error.message;
    const code=message==='Schedule planner stalled; publication remains pending'?'PLANNER_STALLED':
      message==='Schedule planning time limit reached; publication remains pending'?'PLANNING_TIMEOUT':
      message==='Schedule publication deferred by runtime protection'?'RUNTIME_GUARD':
      message==='Schedule planner exited before publication'?'WORKER_EXITED':
      message==='Run time budget reached'||message==='Playout is stale, behind, or awaiting its next asset'?'RUNTIME_GUARD':'DEFERRED';
    return `Schedule publication deferred (${code})`;
  }
  const code=error instanceof Error&&error.name==='DataCloneError'?'DATA_CLONE_FAILED':failureCode(error);
  return `Schedule publication failed (${code})`;
}

/** Plan off the download worker's event loop; bound both stalled and total work. */
export async function publishSchedule(app:AppConfig,guardSeconds:number,check:()=>void,
  options:{stallMs?:number;timeoutMs?:number;workerUrl?:URL;policy?:AcquisitionConfig}={}):Promise<void> {
  check();
  // The complete private-snapshot publisher took ~111s on the Pi at its 25%
  // quota. Allow variation while retaining an independent bounded watchdog.
  const timeoutMs=options.timeoutMs??600_000,stallMs=options.stallMs??300_000;
  const worker=new Worker(options.workerUrl??new URL('./publication-worker.js',import.meta.url),{
    workerData:{app,guardSeconds,deadline:Date.now()+timeoutMs,policy:options.policy},
  });
  let progress=Date.now(),settled=false;
  await new Promise<void>((resolve,reject)=>{
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearInterval(watch);clearTimeout(timer);
      void worker.terminate().then(()=>error?reject(error):resolve());};
    const watch=setInterval(()=>{try{check();if(Date.now()-progress>stallMs)finish(new Deferred('Schedule planner stalled; publication remains pending'));}
      catch(error){finish(error instanceof Deferred
        ? new Deferred('Schedule publication deferred by runtime protection')
        : new PublicationFailure('guard',failureCode(error)));}},Math.min(1000,stallMs));
    const timer=setTimeout(()=>finish(new Deferred('Schedule planning time limit reached; publication remains pending')),timeoutMs);
    worker.on('message',(message:{type:string;stage?:string;code?:string})=>{
      if(message.type==='progress')progress=Date.now();
      if(message.type==='completed')finish();
      if(message.type==='failed'){
        const stage=['open','guard','backup','schedule','epg'].includes(message.stage??'')?message.stage!:'unknown';
        const code=/^(?:[A-Z][A-Z0-9_]{0,39})$/.test(message.code??'')?message.code!:'UNEXPECTED';
        finish(new PublicationFailure(stage,code));
      }
    });
    worker.on('error',error=>finish(new PublicationFailure('worker',failureCode(error))));
    worker.on('exit',()=>{if(!settled)finish(new Deferred('Schedule planner exited before publication'));});
  });
}
