import fs from 'node:fs';
import type {AdAsset,AppConfig,MediaItem,ScheduleEntry,PlayoutSegment} from './types.js';
import {eligibleFor,profileWindow} from './channels.js';
import {ageEligible} from './children-policy.js';
import {programmeEligible} from './acquisition/programming.js';
import {adAvailableAt} from './advertising/availability.js';
import {stationAssets} from './channel-schedule.js';
import type {AdBumper} from './editorial.js';
import type {RotationClip} from './intermissions/rotation.js';
import {seasonAt} from './intermissions/season.js';

export const recoveryState=()=>({uses:new Map<string,number>(),lastShow:'',staticUntil:0});
/** Decoder failures use playable content, with a five-second ceiling on logo cards. */
export function playableRecovery(template:ScheduleEntry,from:number,until:number,catalogue:MediaItem[],config:AppConfig,
 state:ReturnType<typeof recoveryState>,clips:RotationClip[],ads:AdAsset[],bumpers:AdBumper[]):ScheduleEntry {
 const window=profileWindow(from,config.station!),profile=window.profile;
 const stop=Math.min(until,window.endsAtMs),budget=stop-from;
 const excluded=new Set([template.mediaId,...(template.playoutPlan?.assembly?.sources.map(s=>s.mediaId)??[])]);
 const candidates=catalogue.filter(m=>!excluded.has(m.id)&&eligibleFor(m,profile,config.station,from)&&fs.existsSync(m.mediaPath)&&programmeEligible(m,from,config.channel.timezone)&&(profile!=='lkp'||ageEligible(m,config.children)));
 const order=(a:MediaItem,b:MediaItem)=>(state.uses.get(a.id)??0)-(state.uses.get(b.id)??0)||b.durationMs-a.durationMs||a.id.localeCompare(b.id);
 let media=candidates.filter(m=>m.durationMs<=budget).sort(order)[0];
 let segments:PlayoutSegment[]=[];let duration=0,showId='',title='',mediaId='';
 if(media){duration=media.durationMs;showId=media.showId;title=media.episodeTitle;mediaId=media.id;segments=[{type:'content',mediaId:media.id,mediaPath:media.mediaPath,subtitles:media.subtitles,fromMs:0,toMs:duration,durationMs:duration}];}
 if(!media&&profile==='lkp'&&config.advertising?.enabled){
  const bumper=bumpers.find(b=>fs.existsSync(b.mediaPath));
  const ad=ads.filter(a=>a.enabled&&(!a.ageSuitability||/^(all(?:-ages)?|family|children|toddler|preschool|0\+?)$/i.test(a.ageSuitability))&&bumper&&a.durationMs+bumper.durationMs<=budget&&adAvailableAt(a,from+bumper.durationMs)&&fs.existsSync(a.mediaPath)).sort((a,b)=>(state.uses.get(a.id)??0)-(state.uses.get(b.id)??0)||a.id.localeCompare(b.id))[0];
  if(ad&&bumper){duration=ad.durationMs+bumper.durationMs;showId='lkp-advertising';title=ad.title;mediaId=ad.id;segments=[{type:'ad-ident',mediaPath:bumper.mediaPath,durationMs:bumper.durationMs,character:bumper.character},{type:'ad',mediaPath:ad.mediaPath,durationMs:ad.durationMs,adId:ad.id,tags:[...ad.tags]}];}
 }
 if(!duration&&profile==='lkp'&&state.lastShow!=='lkp-intermissions'){
  const clip=clips.filter(c=>c.durationMs<=budget&&(!c.season||c.season===seasonAt(new Date(from)))&&fs.existsSync(c.mediaPath)).sort((a,b)=>(state.uses.get(a.id)??0)-(state.uses.get(b.id)??0)||b.durationMs-a.durationMs)[0];
  if(clip){duration=clip.durationMs;showId='lkp-intermissions';title=clip.title;mediaId=clip.id;segments=[{type:'intermission',intermissionId:clip.id,mediaPath:clip.mediaPath,durationMs:duration}];}
 }
 // Ordinary programme boundaries are soft during recovery; the next profile
 // handover is hard. Prefer a whole programme to repeated station cards.
 if(!duration&&budget>5000){media=candidates.filter(m=>m.durationMs<=window.endsAtMs-from).sort(order)[0];if(media){duration=media.durationMs;showId=media.showId;title=media.episodeTitle;mediaId=media.id;segments=[{type:'content',mediaId:media.id,mediaPath:media.mediaPath,subtitles:media.subtitles,fromMs:0,toMs:duration,durationMs:duration}];}}
 if(!duration){
  const asset=stationAssets(config).get(profile==='ln'?'ident':'day-continuity')!;
  const ms=Math.min(5000,budget);
  if(ms<=0||state.staticUntil>from-100)throw new Error('No playable recovery content; refusing an extended static logo');
  state.staticUntil=from+ms;state.lastShow='station-'+profile;
  const {playoutPlan:_old,...plain}=template;
  return {...plain,id:template.id+':logo-recovery:'+from,mediaId:'station-'+profile,showId:'station-'+profile,mediaPath:asset.path,startsAtMs:from,endsAtMs:from+ms,durationMs:ms,listingVisibility:'hidden',presentation:{profile,kind:'gap',loop:true}};
 }
 state.uses.set(mediaId,(state.uses.get(mediaId)??0)+1);state.lastShow=showId;
 const id=template.id+':content-recovery:'+from;
 return {id,sequence:template.sequence,mediaId:media?.id??mediaId,showId,showTitle:media?.showTitle??title,episodeTitle:title,description:title,startsAtMs:from,endsAtMs:from+duration,durationMs:duration,mediaPath:segments[0]!.mediaPath,audioLanguage:media?.audioLanguage??'mul',subtitleLanguages:media?.subtitles.map(s=>s.language)??[],listingVisibility:'hidden',presentation:{profile,kind:'programme'},playoutPlan:{version:1,programmeEventId:id,sourceDurationMs:duration,durationMs:duration,segments,warnings:[],assembly:{slot:'recovery',premiereDate:'recovery',sources:media?[{mediaId:media.id,fromMs:0,toMs:duration}]:[]}}};
}
