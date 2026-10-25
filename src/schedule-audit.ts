import {DateTime} from 'luxon';
import type {AppConfig,MediaItem,ScheduleEntry} from './types.js';
import {ageEligible} from './children-policy.js';
import {profileWindow} from './channels.js';
import {isCatalogueMovie} from './catalogue.js';
import {adAvailableAt} from './advertising/availability.js';

/** Read-only quality gates used before publication and by diagnostics. */
export function auditSchedule(rows:ScheduleEntry[],media:MediaItem[],config:AppConfig) {
 const errors:string[]=[];const byId=new Map(media.map(m=>[m.id,m]));
 const days=new Map<string,Map<string,number>>(),ads=new Map<string,Map<string,number>>();
 const shows=new Map<string,number>(),languages=new Map<string,number>(),adIds=new Set<string>();
 const lastMovie=new Map<string,number>();
 let staticRun=0,maxStaticMs=0,maxAdRunMs=0,adRun=0,previous:ScheduleEntry|undefined;
 const count=(map:Map<string,Map<string,number>>,day:string,id:string)=>{const bucket=map.get(day)??new Map<string,number>();bucket.set(id,(bucket.get(id)??0)+1);map.set(day,bucket);return bucket.get(id)!;};
 for(const e of rows) {
  if(previous && previous.endsAtMs!==e.startsAtMs)errors.push(`Timeline gap or overlap: ${e.id}`);
  if(e.endsAtMs-e.startsAtMs!==e.durationMs)errors.push(`Incorrect duration: ${e.id}`);
  const window=config.station?.enabled?profileWindow(e.startsAtMs,config.station):undefined;
  if(window && (e.presentation?.profile!==window.profile || e.endsAtMs>window.endsAtMs))errors.push(`Profile boundary mismatch: ${e.id}`);
  if(e.presentation?.kind==='handover' && window && e.startsAtMs!==window.startsAtMs)errors.push(`Late handover: ${e.id}`);
  staticRun=e.presentation?.kind==='gap'?staticRun+e.durationMs:0;
  if(e.presentation?.kind==='gap'){maxStaticMs=Math.max(maxStaticMs,staticRun);if(staticRun>5000)errors.push(`Static logo exceeds five seconds: ${e.id}`);}
  if(e.showId==='lkp-intermissions' && previous?.showId==='lkp-intermissions')errors.push(`Consecutive intermissions: ${e.id}`);
  adRun=e.showId==='lkp-advertising'?adRun+e.durationMs:0;maxAdRunMs=Math.max(maxAdRunMs,adRun);
  if(config.children?.adBreakEveryMinutes && adRun>180_000)errors.push(`Advertising run exceeds three minutes: ${e.id}`);
  if(e.presentation?.profile==='ln' && e.presentation.kind==='programme'){const m=byId.get(e.mediaId);if(m&&isCatalogueMovie(m)){const last=lastMovie.get(m.id);if(last!==undefined && config.station?.minimumMovieRepeatHours && e.startsAtMs-last<config.station.minimumMovieRepeatHours*3600_000)errors.push(`Movie repeats too soon: ${m.id}`);lastMovie.set(m.id,e.startsAtMs);}}
  if(e.presentation?.profile==='lkp') {
   let at=e.startsAtMs;
   for(const segment of e.playoutPlan?.segments??[]) {
    const date=DateTime.fromMillis(at,{zone:config.channel.timezone}).toISODate()!;
    if(segment.type==='content') {
     const m=byId.get(segment.mediaId??e.mediaId);
     if(!m||!ageEligible(m,config.children))errors.push(`Age-incompatible or missing source: ${e.id}`);
     if(m){
      if((segment.fromMs??0)<0 || (segment.toMs??m.durationMs)>m.durationMs)errors.push(`Invalid source bounds: ${e.id}`);
      const n=(segment.fromMs??0)===0?count(days,date,m.id):0;if(config.children?.maximumEpisodePlaysPerDay && n>config.children.maximumEpisodePlaysPerDay)errors.push(`Episode daily repeat limit: ${m.id} ${date}`);
      shows.set(m.showId,(shows.get(m.showId)??0)+segment.durationMs);
      const language=m.audioLanguage??m.defaultLanguage??'unknown';languages.set(language,(languages.get(language)??0)+segment.durationMs);
     }
    }
    if(segment.type==='ad') {
     adIds.add(segment.adId);const n=count(ads,date,segment.adId);
     if(config.children?.maximumAdPlaysPerDay && n>config.children.maximumAdPlaysPerDay)errors.push(`Ad daily repeat limit: ${segment.adId} ${date}`);
     if(!adAvailableAt(segment,at))errors.push(`Seasonal ad violation: ${segment.adId}`);
     if(e.playoutPlan?.segments[0]?.type!=='ad-ident')errors.push(`Unannounced ad block: ${e.id}`);
    }
    at+=segment.durationMs;
   }
  }
  previous=e;
 }
 const maxDailyEpisodeUses=Math.max(0,...[...days.values()].flatMap(v=>[...v.values()]));
 const maxDailyAdUses=Math.max(0,...[...ads.values()].flatMap(v=>[...v.values()]));
 const spoken=[...languages].filter(([l])=>['de','en','cs'].includes(l)).reduce((sum,[,n])=>sum+n,0);
 return {errors,metrics:{events:rows.length,maxStaticMs,maxAdRunMs,maxDailyEpisodeUses,maxDailyAdUses,distinctAds:adIds.size,showMinutes:Object.fromEntries([...shows].map(([k,n])=>[k,Math.round(n/6000)/10])),spokenShares:Object.fromEntries([...languages].filter(([l])=>['de','en','cs'].includes(l)).map(([l,n])=>[l,Math.round(1000*n/Math.max(1,spoken))/10]))}};
}
