import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readPlayoutStatus } from '../playout-status.js';
import { assertMediaStorage } from '../media-storage.js';
import type { AppConfig } from '../types.js';

export interface Settings { topic:string; vpnExpiresAt:string; mutedUntil:string; reserveBytes:number }
export interface Incident { value:string; since:number; notified:string }
export interface MonitorState { armed:boolean; incidents:Record<string,Incident>; retryAt:number }
export interface Notice { key:string; value:string; message:string }
export function evaluate(state:MonitorState, conditions:Record<string,string>, now:number):Notice[] {
  const result:Notice[]=[];
  for(const [key,value] of Object.entries(conditions)) {
    let incident=state.incidents[key];
    if(!incident) incident=state.incidents[key]={value,since:now,notified:''};
    if(incident.value!==value){incident.value=value;incident.since=now;}
    if(now-incident.since<120_000 || incident.notified===value)continue;
    if(value)result.push({key,value,message:value});
    else if(incident.notified)result.push({key,value,message:`Resolved: ${key}.`});
  }
  return result;
}
export function savePrivate(file:string,value:unknown):void {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,file);
}
export async function publish(topic:string,message:string):Promise<void> {
  if(!/^lkp-[a-f0-9]{32}$/.test(topic))throw new Error('Invalid private notification topic');
  const response=await fetch(`https://ntfy.sh/${topic}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Title:'Lundenburg Kids Premium',Tags:'warning',...(message.includes('Hide.me')?{Click:'https://member.hide.me/'}:{})},body:message});
  await response.body?.cancel();
  if(!response.ok)throw new Error('Notification delivery failed');
}
function serviceFailed():boolean {
  try{return execFileSync('systemctl',['show','lkp-content.service','--property=ActiveState','--value'],{encoding:'utf8',timeout:3000}).trim()==='failed';}catch{return false;}
}
export async function check(app:AppConfig,settings:Settings,state:MonitorState,now=Date.now(),send=publish):Promise<{sent:number;state:MonitorState}> {
  const heartbeat=readPlayoutStatus(path.join(app.storage.runtimeDirectory,'playout-status.json'),now);
  const fresh=Boolean(heartbeat?.state==='running' && now-heartbeat.updatedAtMs<30_000);
  if(fresh)state.armed=true;
  const conditions:Record<string,string>={
    broadcast:state.armed&&!fresh?'Broadcast playout stopped or its heartbeat is stale. Check the Pi.':'',
    acquisition:serviceFailed()?'Content acquisition service failed. Check its journal; routine episode failures are suppressed.':'',
    storage:'',
    'VPN membership':Date.parse(settings.vpnExpiresAt)<=now?`Hide.me free membership has expired. Renew it at member.hide.me, then update the reminder expiry on the Pi.`:'',
  };
  try {assertMediaStorage(app);const disk=fs.statfsSync(app.media.root);if(disk.bavail*disk.bsize<settings.reserveBytes)conditions.storage='Media drive has reached the free-space reserve. Acquisition may be paused; inspect storage.';}
  catch{conditions.storage='Media drive is unavailable. Check its connection/mount on the Pi.';}
  const notices=evaluate(state,conditions,now);
  if(Date.parse(settings.mutedUntil)>now){for(const incident of Object.values(state.incidents))incident.notified='';return {sent:0,state};}
  if(!notices.length||state.retryAt>now)return {sent:0,state};
  try {await send(settings.topic,notices.map(n=>n.message).join('\n\n'));for(const notice of notices)state.incidents[notice.key]!.notified=notice.value;state.retryAt=0;return {sent:1,state};}
  catch{state.retryAt=now+15*60_000;return {sent:0,state};}
}
