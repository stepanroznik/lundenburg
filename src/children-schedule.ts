import fs from 'node:fs';
import { DateTime } from 'luxon';
import type { AppConfig, MediaItem, ScheduleEntry, PlayoutSegment } from './types.js';
import { ageEligible, childrenPolicy, daypart } from './children-policy.js';
import { eligibleFor } from './channels.js';
import { readRotationLibrary, type RotationClip } from './intermissions/rotation.js';
import { seasonAt } from './intermissions/season.js';
import type { AdBumper } from './editorial.js';
import type { AdAsset } from './types.js';
import { programmeEligible, programmeOrder } from './acquisition/programming.js';
import { isCatalogueMovie } from './catalogue.js';
import { stableId } from './util.js';
import { childrenState, type ChildrenState } from './children-state.js';
import { adAvailableAt } from './advertising/availability.js';

export interface ChildrenFillers { clips: RotationClip[]; ads: AdAsset[]; bumpers: AdBumper[]; state?: ChildrenState }
interface Source { media: MediaItem; fromMs: number; toMs: number; part?: number; parts?: number }
/** Split only at explicit editorial boundaries, never by duration alone. */
export function programmeParts(media: MediaItem, maximumMs: number): Source[] {
  if (media.durationMs <= maximumMs) return [{ media, fromMs: 0, toMs: media.durationMs }];
  const boundaries = [...new Set([0, ...(media.editorialMarkers ?? []).filter(m => m.kind === 'chapter' && m.confidence >= .7).map(m => m.startMs),
    ...(media.breakpoints ?? []).filter(b => b.enabled && b.source === 'manual' && b.confidence >= .9).map(b => b.atMs), media.durationMs])]
    .filter(n => Number.isSafeInteger(n) && n >= 0 && n <= media.durationMs).sort((a,b)=>a-b);
  const result: Source[] = [];
  let cursor = 0;
  while (cursor < media.durationMs) {
    const next = boundaries.filter(n => n > cursor && n-cursor <= maximumMs).at(-1);
    if (next === undefined) return []; // Keep unsegmentable programmes intact for a longer window.
    result.push({ media, fromMs: cursor, toMs: next }); cursor = next;
  }
  return result.map((p,i) => ({ ...p, part: i+1, parts: result.length }));
}

/** Compiles daytime windows inside the existing station timeline and persists ordinary playout plans. */
export function buildChildrenSchedule(catalogue: MediaItem[], seed: string, startMs: number, endMs: number,
  initialSequence: number, previous: ScheduleEntry[], config: AppConfig, fillers?: ChildrenFillers): ScheduleEntry[] {
  const c = config.children!;
  if (!config.station?.enabled) throw new Error('Children clock requires station profile barriers');
  const zone = config.channel.timezone;
  const state=fillers?.state ?? childrenState();
  const exists=(file:string)=>{if(!state.paths.has(file))state.paths.set(file,fs.existsSync(file));return state.paths.get(file)!;};
  const policy=(m:MediaItem)=>{if(!state.policies.has(m.id)){const p=childrenPolicy(m,c);if(p)state.policies.set(m.id,p);}return state.policies.get(m.id)!;};
  const weekAt=(at:number)=>{const day=Math.floor(at/86400000);if(!state.weeks.has(day))state.weeks.set(day,DateTime.fromMillis(at,{zone}).startOf('week').toMillis());return state.weeks.get(day)!;};
  const localDate=(at:number)=>DateTime.fromMillis(at,{zone}).toISODate()!;
  const library = catalogue.filter(m => eligibleFor(m,'lkp',config.station,startMs) && ageEligible(m,c) && exists(m.mediaPath) && Number.isSafeInteger(m.durationMs) && m.durationMs > 0);
  if(!library.length) throw new Error('No playable age-eligible children programmes; preserve the existing schedule');
  const showWeights=new Map(library.map(m=>[m.showId,policy(m).targetWeeklyAirtimeMinutes]));
  const targetWeight=[...showWeights.values()].reduce((a,b)=>a+b,0);
  const clips=fillers?.clips ?? readRotationLibrary(config);
  const toleranceMs=(c.boundaryToleranceSeconds ?? 5)*1000;
  const consumed=new Set<string>();
  const result: ScheduleEntry[] = [];
  let cursor = startMs, sequence = initialSequence;
  const catalogueById=new Map(catalogue.map(m=>[m.id,m]));
  const {fillerLastUse,useCounts,lastUses,showAirtime,languageAirtime,dailyUses,adUses,dailyAdUses}=state;
  let previousShow=previous.at(-1)?.showId;
  const account=(e:ScheduleEntry)=>{
    if(e.presentation?.profile==='ln' || state.events.has(e.id)) return;
    state.events.set(e.id,e);
    state.adRunMs=e.showId==='lkp-advertising'?state.adRunMs+e.durationMs:0;
    const date=localDate(e.startsAtMs);
    if(e.playoutPlan?.assembly && !e.playoutPlan.assembly.rerunOf && e.playoutPlan.assembly.sources.length) {
      const key=e.playoutPlan.assembly.premiereDate+':'+e.playoutPlan.assembly.slot;
      if(!state.originals.has(key))state.originals.set(key,e);
    }
    for(const segment of e.playoutPlan?.segments ?? [])if(segment.type==='ad'){
      adUses.set(segment.adId,(adUses.get(segment.adId)??0)+1);
      const key=date+':'+segment.adId;dailyAdUses.set(key,(dailyAdUses.get(key)??0)+1);state.lastAdEnd=e.endsAtMs;
    }
    fillerLastUse.set(e.mediaId,e.endsAtMs);
    const sources=e.playoutPlan?.assembly?.sources ?? [{mediaId:e.mediaId,fromMs:0,toMs:e.durationMs}];
    for(const source of sources) {
      const key=`${source.mediaId}:${source.fromMs}`;
      useCounts.set(key,(useCounts.get(key) ?? 0)+1);lastUses.set(source.mediaId,e.endsAtMs);
      const dailyKey=date+':'+source.mediaId;if(source.fromMs===0)dailyUses.set(dailyKey,(dailyUses.get(dailyKey)??0)+1);
    }
    const week=weekAt(e.startsAtMs);
    if(sources.length)state.totalAirtime.set(week,(state.totalAirtime.get(week)??0)+e.durationMs);
    const showKey=`${week}:${e.showId}`;
    showAirtime.set(showKey,(showAirtime.get(showKey) ?? 0)+e.durationMs);
    for(const source of sources) {
      const media=catalogueById.get(source.mediaId);
      const language=media?.audioLanguage ?? media?.defaultLanguage ?? e.audioLanguage;
      if(language && ['de','en','cs'].includes(language)) {
        const key=`${week}:${language}`;
        languageAirtime.set(key,(languageAirtime.get(key) ?? 0)+source.toMs-source.fromMs);
      }
    }
  };
  previous.forEach(account);
  const uses=(m:MediaItem,fromMs=0)=>useCounts.get(`${m.id}:${fromMs}`) ?? 0;
  const lastUse=(m:MediaItem)=>lastUses.get(m.id) ?? 0;
  const push = (e: ScheduleEntry) => { result.push(e);account(e);previousShow=e.showId;cursor=e.endsAtMs;sequence++; };
  const interstitial = (until:number,slot:string,date:string,hard=false):boolean => {
    if(previousShow==='lkp-intermissions') return false;
    const remaining=until-cursor;
    const eligible=clips.filter(clip=>(!clip.season || clip.season===seasonAt(new Date(cursor))) && exists(clip.mediaPath));
    // Prefer useful short programmes above; these finite published films fill the residual.
    const last=result.at(-1)?.mediaId ?? previous.at(-1)?.mediaId;
    const choices=eligible.filter(clip=>Math.abs(clip.durationMs-remaining)<=toleranceMs && (!hard || clip.durationMs===remaining));
    choices.sort((a,b)=>((fillerLastUse.get(`intermission-${a.id}`) ?? 0)>cursor-30*60_000?1:0)-((fillerLastUse.get(`intermission-${b.id}`) ?? 0)>cursor-30*60_000?1:0) ||
      (`intermission-${a.id}`===last?1:0)-(`intermission-${b.id}`===last?1:0) ||
      Math.abs(remaining-a.durationMs)-Math.abs(remaining-b.durationMs) || a.id.localeCompare(b.id));
    let clip=choices[0], durationMs=clip?.durationMs;
    if (!clip && hard) {
      // Only the tail of a station ident may be bounded at an immutable station/weather handover.
      // Programmes and ads always run intact; never introduce a loop or a holding screen.
      clip=eligible.filter(c=>c.kind==='ident' && c.durationMs<=10_000 && c.durationMs>=remaining).sort((a,b)=>a.durationMs-b.durationMs || a.id.localeCompare(b.id))[0];
      if(clip) durationMs=remaining;
    }
    if(!clip || !durationMs) return false;
    const id=stableId(seed,'filler',clip.id,cursor);
    push({id,sequence,mediaId:`intermission-${clip.id}`,showId:'lkp-intermissions',showTitle:'Lundenburg Kids Premium',episodeTitle:clip.title,description:clip.synopsis,
      startsAtMs:cursor,endsAtMs:cursor+durationMs,durationMs,mediaPath:clip.mediaPath,audioLanguage:clip.languages.length===1?clip.languages[0]!:'mul',subtitleLanguages:[],listingVisibility:'hidden',presentation:{profile:'lkp',kind:'programme'},
      playoutPlan:{version:1,programmeEventId:id,sourceDurationMs:clip.durationMs,durationMs,segments:[{type:'intermission',mediaPath:clip.mediaPath,durationMs,intermissionId:clip.id}],warnings:[],assembly:{slot,premiereDate:date,sources:[]}}});
    return true;
  };
  const advertisement=(until:number,slot:string,date:string,hard=false,requireClosure=false,variety=false,probe=false):boolean=>{
    if(!config.advertising?.enabled || !config.station?.profiles.lkp.advertising) return false;
    const bumper=fillers?.bumpers.filter(b=>exists(b.mediaPath)).sort((a,b)=>a.mediaPath.localeCompare(b.mediaPath))[0];
    if(!bumper) return false;
    // Enabled entries are the curated station ad library. Older ingests have no
    // age label; do not discard that library for missing optional metadata.
    let available=(fillers?.ads ?? []).filter(ad=>ad.enabled && (!ad.ageSuitability || /^(?:all(?:-ages)?|children|family|toddler|preschool|0\+?)$/i.test(ad.ageSuitability)) && adAvailableAt(ad,cursor+bumper.durationMs) && exists(ad.mediaPath) && Number.isSafeInteger(ad.durationMs) && ad.durationMs>0);
    if(c.maximumAdPlaysPerDay)available=available.filter(ad=>(dailyAdUses.get(date+':'+ad.id)??0)<c.maximumAdPlaysPerDay!);
    if(variety){
      const ranked=[...available].sort((a,b)=>(adUses.get(a.id)??0)-(adUses.get(b.id)??0)||a.id.localeCompare(b.id));
      const short=[...available].sort((a,b)=>a.durationMs-b.durationMs).slice(0,2);
      available=[...new Map([...ranked.slice(0,12),...short].map(ad=>[ad.id,ad])).values()];
    }
    const remaining=until-cursor, limit=Math.min(remaining+(hard?0:toleranceMs),variety?180_000:Infinity,c.adBreakEveryMinutes?180_000-state.adRunMs:Infinity);
    if(limit<=0)return false;
    const candidates:{ads:AdAsset[];durationMs:number;finish:boolean;nextClose?:boolean;recent:number;uses:number;key:string}[]=[];
    const eligibleClips=clips.filter(clip=>(!clip.season || clip.season===seasonAt(new Date(cursor))) && exists(clip.mediaPath));
    const canFinish=(duration:number)=>{
      const rest=remaining-duration;
      return rest<=toleranceMs && (!hard || rest===0) || eligibleClips.some(clip=>Math.abs(rest-clip.durationMs)<=toleranceMs && (!hard || clip.durationMs===rest)) || hard && eligibleClips.some(clip=>clip.kind==='ident' && clip.durationMs<=10_000 && rest>0 && rest<=clip.durationMs);
    };
    const target=config.advertising.targetSeconds.max*1000;
    const add=(ads:AdAsset[],durationMs:number)=>{
      if(durationMs>limit)return;
      if(c.maximumAdPlaysPerDay && ads.some(ad=>(dailyAdUses.get(date+':'+ad.id)??0)>=c.maximumAdPlaysPerDay!))return;
      candidates.push({ads,durationMs,key:ads.map(ad=>ad.id).join('|'),finish:canFinish(durationMs),uses:Math.max(...ads.map(ad=>adUses.get(ad.id)??0)),recent:ads.reduce((sum,ad)=>sum+((fillerLastUse.get(`ad-${ad.id}`) ?? 0)>cursor-10*60_000?1:0),0)});
    };
    // A single WERBUNG ident introduces the whole pod, with up to three distinct
    // intact spots. Evaluate spot validity at its actual position in the pod.
    for(let i=0;i<available.length;i++) {
      const a=available[i]!;
      if(!adAvailableAt(a,cursor+bumper.durationMs))continue;
      const first=bumper.durationMs+a.durationMs;add([a],first);
      if(first>=Math.min(limit,target))continue;
      for(let j=i+1;j<available.length;j++) {
        const b=available[j]!;
        if(!adAvailableAt(b,cursor+first))continue;
        const second=first+b.durationMs;
        if(second>Math.min(limit,target))continue;
        add([a,b],second);
        for(let k=j+1;k<available.length;k++) {
          const d=available[k]!,third=second+d.durationMs;
          if(third>Math.min(limit,target)||!adAvailableAt(d,cursor+second))continue;
          add([a,b,d],third);
        }
      }
    }
    const durations=[...new Set(candidates.map(p=>p.durationMs))].sort((a,b)=>a-b);
    const hasDuration=(from:number,to:number)=>{
      let low=0,high=durations.length;
      while(low<high){const middle=(low+high)>>>1;if(durations[middle]!<from)low=middle+1;else high=middle;}
      return low<durations.length && durations[low]!<=to;
    };
    // A closing path may need three pods, for example three 30-second pods
    // and an 11-second film. Look ahead without committing a partial path.
    const pairDurations=hard?[...new Set(durations.flatMap(a=>durations.filter(b=>a+b<=limit).map(b=>a+b)))].sort((a,b)=>a-b):[];
    const hasPairDuration=(from:number,to:number)=>{
      let low=0,high=pairDurations.length;
      while(low<high){const middle=(low+high)>>>1;if(pairDurations[middle]!<from)low=middle+1;else high=middle;}
      return low<pairDurations.length && pairDurations[low]!<=to;
    };
    const hasClosingDuration=(from:number,to:number)=>hasDuration(from,to)||hasPairDuration(from,to);
    const identLimit=Math.max(0,...eligibleClips.filter(c=>c.kind==='ident' && c.durationMs<=10_000).map(c=>c.durationMs));
    for(const pod of candidates) {
      const rest=remaining-pod.durationMs;
      const ceiling=limit-pod.durationMs;
      pod.nextClose=hasClosingDuration(rest-(hard?identLimit:toleranceMs),Math.min(ceiling,rest+(hard?0:toleranceMs))) || eligibleClips.some(clip=>hasClosingDuration(rest-clip.durationMs-(hard?0:toleranceMs),Math.min(ceiling,rest-clip.durationMs+(hard?0:toleranceMs))));
    }
    const compare=(a:typeof candidates[number],b:typeof candidates[number])=>(variety?a.uses-b.uses || a.recent-b.recent:0) || Number(b.finish)-Number(a.finish) || Number(b.nextClose)-Number(a.nextClose) || a.recent-b.recent || Math.abs(remaining-a.durationMs)-Math.abs(remaining-b.durationMs) || (a.key<b.key?-1:a.key>b.key?1:0);
    let pod:typeof candidates[number]|undefined;
    for(const candidate of candidates){if((requireClosure || c.adBreakEveryMinutes && remaining<=180_000) && !candidate.finish && !candidate.nextClose)continue;if(!pod || compare(candidate,pod)<0)pod=candidate;}
    if(!pod)return false;
    if(probe)return true;
    const {durationMs}=pod,id=stableId(seed,'ad-filler',...pod.ads.map(ad=>ad.id),cursor);
    for(const ad of pod.ads)fillerLastUse.set(`ad-${ad.id}`,cursor+durationMs);
    push({id,sequence,mediaId:`ad-${pod.ads[0]!.id}`,showId:'lkp-advertising',showTitle:'Werbung',episodeTitle:pod.ads.map(ad=>ad.title).join(' / '),description:pod.ads.map(ad=>ad.title).join(' / '),
      startsAtMs:cursor,endsAtMs:cursor+durationMs,durationMs,mediaPath:bumper.mediaPath,audioLanguage:pod.ads[0]!.language,subtitleLanguages:[],listingVisibility:'hidden',presentation:{profile:'lkp',kind:'programme'},
      playoutPlan:{version:1,programmeEventId:id,sourceDurationMs:durationMs,durationMs,segments:[{type:'ad-ident',mediaPath:bumper.mediaPath,durationMs:bumper.durationMs,character:bumper.character},...pod.ads.map(ad=>({type:'ad' as const,mediaPath:ad.mediaPath,durationMs:ad.durationMs,adId:ad.id,tags:[...ad.tags]}))],warnings:[],assembly:{slot,premiereDate:date,sources:[]}}});return true;
  };
  const make = (showId: string | undefined, until: number, slot: string, premiereDate: string,tailMode=false): boolean => {
    const budget = until-cursor;
    const local = DateTime.fromMillis(cursor,{zone}), part = daypart(local.hour+local.minute/60);
    const dayKey=local.toISODate()!;
    const candidates = library.filter(m => {
      if(showId && m.showId!==showId)return false;
      if(!state.parts.has(m.id))state.parts.set(m.id,programmeParts(m,policy(m).preferredSlotDurationMinutes*60_000));
      const parts=state.parts.get(m.id)!;
      const minimum=parts.length?Math.min(...parts.map(p=>p.toMs-p.fromMs)):m.durationMs;
      const continuing=parts.length>1 && uses(m,parts[0]!.fromMs)>uses(m,parts.at(-1)!.fromMs);
      const key=dayKey+':'+m.id;if(!state.seasonal.has(key))state.seasonal.set(key,programmeEligible(m,cursor,zone));
      return minimum<=budget && (!c.minimumFlexibleEpisodeSeconds || showId || tailMode || !['ms-rachel','miss-josi'].includes(m.showId) || minimum>=c.minimumFlexibleEpisodeSeconds*1000) &&
        (!c.maximumEpisodePlaysPerDay || continuing || (dailyUses.get(dayKey+':'+m.id)??0)<c.maximumEpisodePlaysPerDay) &&
        (!c.minimumEpisodeRepeatHours || continuing || lastUse(m)<=cursor-c.minimumEpisodeRepeatHours*3600_000) && eligibleFor(m,'lkp',config.station,cursor) && (!showId || m.showId===showId) && state.seasonal.get(key) && !policy(m).excludedDayparts?.includes(part);});
    const week=weekAt(cursor);
    const spoken=new Map(['de','en','cs'].map(l=>[l,languageAirtime.get(`${week}:${l}`) ?? 0]));
    const total=[...spoken.values()].reduce((a,b)=>a+b,0);
    const weeklyTotal=state.totalAirtime.get(week)??0;
    const scored=new Map<string,Map<object,number>>();
    const score = (m: MediaItem) => {
      const key=m.showId+':'+(m.audioLanguage??m.defaultLanguage??'');const p=policy(m);
      const cached=scored.get(key)?.get(p);if(cached!==undefined)return cached;
      const airtime=(showAirtime.get(`${week}:${m.showId}`) ?? 0)/60_000;
      const language=m.audioLanguage ?? m.defaultLanguage ?? '', targets=config.schedule.spokenLanguageTargets;
      const languageDebt=targets && Object.hasOwn(targets,language) ? ((total+30*60_000)*targets[language as keyof typeof targets]-(spoken.get(language) ?? 0))/600_000 : 0;
      const value=(p.schedulingPriority==='flagship' ? .5 : p.schedulingPriority==='regular' ? .25 : 0) + (p.preferredDayparts[part] ?? 0)*2 + (part==='bedtime' ? p.energyLevel==='calm'?8:p.energyLevel==='high'?-12:0 : 0) +
        (c.balanceShows ? ((weeklyTotal+budget)*p.targetWeeklyAirtimeMinutes/Math.max(1,targetWeight)-airtime*60_000)/1_800_000 : Math.max(-3,1-airtime/Math.max(1,p.targetWeeklyAirtimeMinutes))*3) + languageDebt - (previousShow===m.showId ? 4:0);
      const group=scored.get(key)??new Map<object,number>();group.set(p,value);scored.set(key,group);return value;
    };
    const scores=new Map(candidates.map(m=>[m.id,score(m)]));
    const partsById=new Map(candidates.map(m=>[m.id,state.parts.get(m.id)!]));
    const pending=(m:MediaItem)=>{
      const parts=partsById.get(m.id)!;
      return parts.length>1 && uses(m,parts[0]!.fromMs)>uses(m,parts.at(-1)!.fromMs) ? 1:0;
    };
    const short=(m:MediaItem)=>c.minimumFlexibleEpisodeSeconds && ['ms-rachel','miss-josi'].includes(m.showId) && m.durationMs<c.minimumFlexibleEpisodeSeconds*1000?1:0;
    const compare=(a:MediaItem,b:MediaItem)=>pending(b)-pending(a) || scores.get(b.id)!-scores.get(a.id)! || short(a)-short(b) || uses(a)-uses(b) || lastUse(a)-lastUse(b) || programmeOrder(a,b) || a.id.localeCompare(b.id);
    const byShow=new Map<string,MediaItem[]>();
    for(const m of candidates){const group=byShow.get(m.showId)??[];group.push(m);byShow.set(m.showId,group);}
    const best=new Map([...byShow].map(([id,group])=>[id,group.reduce((a,b)=>compare(a,b)<=0?a:b)]));
    const groups=[...byShow.values()].sort((a,b)=>compare(best.get(a[0]!.showId)!,best.get(b[0]!.showId)!));
    const sources: Source[]=[];
    let remaining=budget;
    for(const group of groups) {
    group.sort(compare);
    for (const m of group) {
      // Assemble consecutive short episodes of one show; fillers form separate listing events.
      if (sources.length && m.showId!==sources[0]!.media.showId) continue;
      const prepared=partsById.get(m.id)!;
      const parts=prepared.length ? prepared : m.durationMs<=budget ? [{media:m,fromMs:0,toMs:m.durationMs}] : [];
      const minimum=Math.min(...parts.map(p=>uses(m,p.fromMs)));
      const source=parts.find(p=>uses(m,p.fromMs)===minimum);
      if (!source || source.toMs-source.fromMs > remaining) continue;
      // Avoid replaying the same source during a block or within the preceding hour when alternatives exist.
      if (lastUse(m)>cursor-60*60_000 && candidates.some(o=>o.id!==m.id && lastUse(o)<=cursor-60*60_000 && o.durationMs<=remaining)) continue;
      sources.push(source);remaining-=source.toMs-source.fromMs;
      if (remaining<30_000) break;
    }
    if(sources.length && tailMode) {
      const closes=()=>{
        const after=cursor+budget-remaining,rest=until-after;
        if(rest===0 || until!==endMs&&rest<=toleranceMs || clips.some(clip=>exists(clip.mediaPath)&&(!clip.season||clip.season===seasonAt(new Date(after)))&&(Math.abs(clip.durationMs-rest)<=(until===endMs?0:toleranceMs)||clip.kind==='ident'&&rest>0&&rest<=Math.min(5000,clip.durationMs))))return true;
        if(rest>180_000)return false;
        const saved=cursor,savedRun=state.adRunMs;cursor=after;state.adRunMs=0;
        try{return advertisement(until,slot,premiereDate,until===endMs,true,false,true);}finally{cursor=saved;state.adRunMs=savedRun;}
      };
      let fits=closes();
      while(!fits && sources.length>1){const removed=sources.pop()!;remaining+=removed.toMs-removed.fromMs;fits=closes();}
      if(!fits)for(const m of group){const source=(partsById.get(m.id)?.length?partsById.get(m.id)!:[{media:m,fromMs:0,toMs:m.durationMs}]).find(p=>p.toMs-p.fromMs<=budget);if(!source)continue;sources.splice(0,sources.length,source);remaining=budget-(source.toMs-source.fromMs);if(closes()){fits=true;break;}}
      if(!fits){sources.length=0;remaining=budget;continue;}
    }
    if(sources.length)break;
    }
    if(until===endMs && remaining>0) {
      // Keep enough room for a real closing ad pod instead of stranding a few
      // seconds that would require a second intermission at a hard handover.
      const identLimit=Math.max(0,...clips.filter(clip=>clip.kind==='ident' && clip.durationMs<=10_000 && exists(clip.mediaPath)).map(clip=>clip.durationMs));
      const bumper=fillers?.bumpers.find(b=>exists(b.mediaPath));
      const adMinimum=bumper && config.advertising?.enabled && config.station!.profiles.lkp.advertising
        ? Math.min(Infinity,...(fillers?.ads ?? []).filter(ad=>ad.enabled && (!ad.ageSuitability || /^(?:all(?:-ages)?|children|family|toddler|preschool|0\+?)$/i.test(ad.ageSuitability)) && adAvailableAt(ad,until-ad.durationMs) && exists(ad.mediaPath)).map(ad=>ad.durationMs+bumper.durationMs)) : Infinity;
      if(Number.isFinite(adMinimum) && remaining>identLimit && !clips.some(clip=>clip.durationMs===remaining && (!clip.season || clip.season===seasonAt(new Date(until-remaining))) && exists(clip.mediaPath)) && remaining<adMinimum && sources.length) {
        const deferred=sources.pop()!;remaining+=deferred.toMs-deferred.fromMs;
      }
    }
    if (!sources.length) return false;
    const first=sources[0]!.media;
    const id=stableId(seed,'assembly',cursor,...sources.map(s=>`${s.media.id}:${s.fromMs}`));
    const segments: PlayoutSegment[]=sources.map(s=>({type:'content',mediaId:s.media.id,mediaPath:s.media.mediaPath,subtitles:s.media.subtitles,fromMs:s.fromMs,toMs:s.toMs,durationMs:s.toMs-s.fromMs}));
    const durationMs=budget-remaining;
    const languages=[...new Set(sources.map(s=>s.media.audioLanguage ?? s.media.defaultLanguage ?? 'zxx'))];
    const titles=sources.map(s=>`${s.part && s.parts ? `${s.part>1?'Fortsetzung · ':''}Teil ${s.part}/${s.parts}: `:''}${s.media.episodeTitle}${s.part && s.parts && s.part<s.parts?' · Fortsetzung folgt':''}`);
    push({id,sequence,mediaId:first.id,showId:first.showId,showTitle:first.showTitle,episodeTitle:titles.join(' / '),description:sources.map(s=>s.media.description).join(' '),
      startsAtMs:cursor,endsAtMs:cursor+durationMs,durationMs,mediaPath:first.mediaPath,audioLanguage:languages.length===1?languages[0]!:'mul',
      subtitleLanguages:[...new Set(sources.flatMap(s=>s.media.subtitles.map(t=>t.language)))],listingVisibility:'public',presentation:{profile:'lkp',kind:'programme'},
      playoutPlan:{version:1,programmeEventId:id,sourceDurationMs:durationMs,durationMs,segments,warnings:[],assembly:{slot,premiereDate,sources:sources.map(s=>({mediaId:s.media.id,fromMs:s.fromMs,toMs:s.toMs,...(s.part?{part:s.part,parts:s.parts!}:{})}))}}});
    return true;
  };
  const rollbackLast = (): boolean => {
    const removed=result.pop();if(!removed)return false;
    cursor=removed.startsAtMs;sequence=removed.sequence;
    state.events.delete(removed.id);const retained=[...state.events.values()];state.events.clear();
    fillerLastUse.clear();useCounts.clear();lastUses.clear();showAirtime.clear();state.totalAirtime.clear();languageAirtime.clear();dailyUses.clear();adUses.clear();dailyAdUses.clear();state.originals.clear();state.lastAdEnd=0;state.adRunMs=0;
    retained.forEach(account);
    previousShow=result.at(-1)?.showId ?? previous.at(-1)?.showId;
    return true;
  };
  const fill = (until:number,slot:string,date:string,showId?:string,hard=false) => {
    const limit=Math.min(endMs,until+(hard?0:toleranceMs));
    let closing=false;
    const startIndex=result.length;
    if (showId) make(showId,limit,slot,date);
    const rollbackFloor=c.adBreakEveryMinutes?result.length:0;
    while(cursor<until) {
      if(!hard && until-cursor<=toleranceMs) return;
      const before=cursor;
      const last=result.at(-1) ?? previous.at(-1);
      const due=Boolean(c.adBreakEveryMinutes && cursor-state.lastAdEnd>=c.adBreakEveryMinutes*60_000 && last?.playoutPlan?.assembly?.sources.length);
      const played=due && advertisement(until,slot,date,hard,false,true) || (closing
        ? (c.adBreakEveryMinutes && make(undefined,until,slot,date,true)) || interstitial(until,slot,date,hard) || advertisement(until,slot,date,hard,true)
        : make(undefined,Math.min(limit,cursor+30*60_000),slot,date) || make(undefined,limit,slot,date) || advertisement(until,slot,date,hard) || interstitial(until,slot,date,hard));
      if(!played) {
        if(!hard && until-cursor<=toleranceMs) return;
        // Rare short songs may close an otherwise impossible residual, under
        // the same daily and repeat limits as full programmes.
        if(c.adBreakEveryMinutes && make(undefined,until,slot,date,true)){closing=true;continue;}
        // Greedy programme/ad selection can strand milliseconds beyond the
        // final ident. Refit generated entries under this same hard boundary;
        // require a complete closing pod path before emitting anything else.
        let recovered=false;
        for(let attempts=0;attempts<4 && result.length>rollbackFloor && rollbackLast();attempts++) {
          if((!hard || !c.adBreakEveryMinutes || until-cursor<=120_000) && advertisement(until,slot,date,hard,true) || c.adBreakEveryMinutes && make(undefined,until,slot,date,true)) {closing=true;recovered=true;break;}
        }
        if(recovered)continue;
        throw new Error(`No playable short programme, approved advertisement or published intermission can fill children programming near ${new Date(cursor).toISOString()}`);
      }
      if (before===cursor) throw new Error('Children compiler made no progress');
    }
  };
  while(cursor<endMs) {
    const local=DateTime.fromMillis(cursor,{zone}), date=local.toISODate()!, midnight=local.startOf('day');
    const slots=c.slots.filter(s=>!s.weekdays || s.weekdays.includes(local.weekday)).map(s=>({...s,start:midnight.set({hour:Number(s.time.slice(0,2)),minute:Number(s.time.slice(3))}).toMillis()})).sort((a,b)=>a.start-b.start);
    const key=(time:string)=>`${date}:${time}`;
    // A slot already in progress at a safe rebuild boundary is left to flexible programming.
    const active=slots.find(s=>!consumed.has(key(s.time)) && Math.abs(s.start-cursor)<=toleranceMs);
    const next=slots.find(s=>!consumed.has(key(s.time)) && s.start>cursor+toleranceMs);
    if (!active) { const until=Math.min(endMs,next?.start ?? local.plus({days:1}).startOf('day').toMillis());fill(until,'flexible',date,undefined,until===endMs);continue; }
    consumed.add(key(active.time));
    const until=Math.min(endMs,active.start+active.minutes*60_000);
    const fillSlot=(showId?:string)=>fill(until,active.time,date,showId,until===endMs);
    if(active.showId==='lkp-weather') {
      const first=result.length;fillSlot();
      for(const entry of result.slice(first)) entry.presentation={...entry.presentation!,block:'weather'};
      continue;
    }
    if(active.showId==='weekend-film' && local.weekday===7) active.rerunOf=active.time;
    if(active.rerunOf) {
      const yesterday=local.minus({days:1}).startOf('day').set({hour:Number(active.rerunOf.slice(0,2)),minute:Number(active.rerunOf.slice(3))}).toMillis();
      const yesterdayDate=local.minus({days:1}).toISODate();
      const original=state.originals.get(yesterdayDate+':'+active.rerunOf);
      const originals=original?[original]:[];
      const sources=originals.flatMap(e=>e.playoutPlan?.assembly?.sources ?? []);
      const compatible=sources.length && sources.every(s=>(!c.maximumEpisodePlaysPerDay || (dailyUses.get(date+':'+s.mediaId)??0)<c.maximumEpisodePlaysPerDay) && library.some(m=>m.id===s.mediaId && programmeEligible(m,cursor,zone) && !childrenPolicy(m,c)!.excludedDayparts?.includes(daypart(local.hour+local.minute/60))));
      const duration=originals.reduce((sum,e)=>sum+e.durationMs,0);
      if(compatible && originals.length && originals.every((e,i)=>!i || originals[i-1]!.endsAtMs===e.startsAtMs) && cursor+duration<=Math.min(endMs,until+toleranceMs)) {
        for(const old of originals) {
          const id=stableId(seed,'rerun',old.id,active.start), plan=old.playoutPlan;
          const {epgEventId:_epg,...base}=old;
          push({...base,id,sequence,startsAtMs:cursor,endsAtMs:cursor+old.durationMs,...(plan?{playoutPlan:{...plan,programmeEventId:id,assembly:{...plan.assembly!,slot:active.time,rerunOf:old.id}}}:{})});
        }
        if(cursor<until-toleranceMs) fillSlot();
        continue;
      }
    }
    if(active.showId==='weekend-film') {
      const film=library.filter(m=>isCatalogueMovie(m) && m.durationMs<=until-cursor).sort((a,b)=>lastUse(a)-lastUse(b) || programmeOrder(a,b))[0];
      fillSlot(film?.showId);continue;
    }
    const show=active.olderShowId && c.targetAgeYears>=6 ? active.olderShowId : active.showId;
    fillSlot(show);
  }
  return result;
}
