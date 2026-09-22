import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AppConfig, ScheduleEntry, IntermissionConfig } from '../types.js';
import type { LkpDatabase } from '../database.js';
import { stableId } from '../util.js';
import { seasonAt, type Season } from './season.js';

export const intermissionShowId = 'lkp-intermissions';
export interface RotationClip {
  id: string; title: string; kind: 'ident' | 'silent' | 'voiced'; season?: Season;
  mediaPath: string; durationMs: number; languages: string[]; synopsis: string;
}
export interface PublishedLibrary { version: 1; revision: string; clips: RotationClip[]; }
const unit = (seed: string, id: string, purpose: string) => createHash('sha256').update(`${seed}\0${id}\0${purpose}`).digest().readUInt32BE(0) / 0x1_0000_0000;
export const isProgramme = (e: ScheduleEntry) => e.showId !== intermissionShowId && e.showId !== 'lkp-weather';

export function readRotationLibrary(config: AppConfig): RotationClip[] {
  if (!config.intermissions?.enabled || !fs.existsSync(config.intermissions.manifest)) return [];
  const manifest = JSON.parse(fs.readFileSync(config.intermissions.manifest,'utf8')) as PublishedLibrary;
  if (manifest.version !== 1 || !manifest.revision || !Array.isArray(manifest.clips) || !manifest.clips.length) throw new Error('Invalid published intermission library');
  const ids = new Set<string>();
  for (const clip of manifest.clips) {
    if (ids.has(clip.id) || !['ident','silent','voiced'].includes(clip.kind) || !Number.isSafeInteger(clip.durationMs) || clip.durationMs <= 0 || clip.durationMs > 120000 || !path.isAbsolute(clip.mediaPath) || !fs.existsSync(clip.mediaPath) || (clip.season && !['spring','summer','autumn','winter'].includes(clip.season))) throw new Error(`Invalid/missing intermission: ${clip.id}`);
    ids.add(clip.id);
  }
  return manifest.clips;
}

export function chooseIntermission(clips: RotationClip[], policy: IntermissionConfig, seed: string, after: ScheduleEntry, atMs: number, previousClip?: string): RotationClip | undefined {
  if (unit(seed,after.id,'break') >= policy.boundaryRate) return;
  const eligible = clips.filter(c=>!c.season||c.season===seasonAt(new Date(atMs)));
  const sum=policy.weights.ident+policy.weights.silent+policy.weights.voiced;
  const pick=unit(seed,after.id,'kind')*sum;
  const kind=pick<policy.weights.ident?'ident':pick<policy.weights.ident+policy.weights.silent?'silent':'voiced';
  let choices=eligible.filter(c=>c.kind===kind);
  if(!choices.length)choices=eligible.filter(c=>c.kind==='ident');
  if(!choices.length)return;
  if(kind!=='ident'&&choices.length>1)choices=choices.filter(c=>c.id!==previousClip);
  choices.sort((a,b)=>a.id.localeCompare(b.id));
  return choices[Math.floor(unit(seed,after.id,'clip')*choices.length)];
}

export function planIntermissions(entries: ScheduleEntry[], clips: RotationClip[], policy: IntermissionConfig, seed: string, earliest: number, weatherUntil: ReadonlyMap<string,number> = new Map()): { entries: ScheduleEntry[]; inserted: ScheduleEntry[] } {
  const slack=Array<number>(entries.length+1).fill(Infinity);
  for(let i=entries.length-1;i>=0;i--){
    const e=entries[i]!;
    const until=weatherUntil.get(e.id);
    slack[i]=Math.min(slack[i+1]!,until===undefined?Infinity:until-e.endsAtMs);
  }
  let shift=0, added=0;
  let previousClip: string|undefined;
  const result: ScheduleEntry[]=[], inserted: ScheduleEntry[]=[];
  for(let i=0;i<entries.length;i++){
    const original=entries[i]!;
    const e={...original,sequence:original.sequence+added,startsAtMs:original.startsAtMs+shift,endsAtMs:original.endsAtMs+shift};
    result.push(e);
    if(e.showId===intermissionShowId)previousClip=e.mediaId.replace(/^intermission-/,'');
    const next=entries[i+1];
    // Only complete programme boundaries, never a break beside weather or another break.
    if(!next || !isProgramme(e)||!isProgramme(next)||original.endsAtMs<earliest)continue;
    const clip=chooseIntermission(clips,policy,seed,original,e.endsAtMs,previousClip);
    if(!clip || shift+clip.durationMs>slack[i+1]!)continue;
    const intermission: ScheduleEntry={id:stableId('intermission-after',original.id),sequence:e.sequence+1,mediaId:`intermission-${clip.id}`,showId:intermissionShowId,showTitle:'Lundenburg Kids Premium',episodeTitle:clip.title,description:clip.synopsis,startsAtMs:e.endsAtMs,endsAtMs:e.endsAtMs+clip.durationMs,durationMs:clip.durationMs,mediaPath:clip.mediaPath,audioLanguage:clip.languages.length===1?clip.languages[0]!:'mul',subtitleLanguages:[]};
    result.push(intermission);inserted.push(intermission);shift+=clip.durationMs;added++;previousClip=clip.id;
  }
  return {entries:result,inserted};
}

export function reconcileIntermissions(db: LkpDatabase, config: AppConfig, now = Date.now()): number {
  const clips=readRotationLibrary(config);
  if(!clips.length||!config.intermissions)return 0;
  return db.db.transaction(()=>{
    const bounds=db.scheduleBounds();if(!bounds)return 0;
    const original=db.listSchedule(now,bounds.lastMs+1);
    const weatherUntil=new Map<string,number>();
    for(const e of original.filter(e=>e.showId==='lkp-weather')){
      const file=path.join(path.dirname(e.mediaPath),'programme.json');
      if(!fs.existsSync(file))throw new Error('Cannot insert intermissions without scheduled weather validity metadata');
      const until=Date.parse(JSON.parse(fs.readFileSync(file,'utf8')).validUntil);
      if(!Number.isFinite(until))throw new Error('Invalid weather validity');
      weatherUntil.set(e.id,until);
    }
    const plan=planIntermissions(original,clips,config.intermissions!,config.schedule.seed,now+60000,weatherUntil);
    if(!plan.inserted.length)return 0;
    const byId=new Map(plan.entries.map(e=>[e.id,e]));
    const update=db.db.prepare('UPDATE schedule_entries SET sequence=?,starts_at_ms=?,ends_at_ms=? WHERE id=?');
    // Descending updates avoid sequence/time uniqueness conflicts. Current and past rows stay intact.
    for(const old of [...original].reverse()){
      const e=byId.get(old.id)!;
      if(e.sequence!==old.sequence||e.startsAtMs!==old.startsAtMs)update.run(e.sequence,e.startsAtMs,e.endsAtMs,e.id);
    }
    db.insertSchedule(plan.inserted);
    return plan.inserted.length;
  }).immediate();
}
