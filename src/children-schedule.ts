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

export interface ChildrenFillers { clips: RotationClip[]; ads: AdAsset[]; bumpers: AdBumper[] }
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
  const library = catalogue.filter(m => eligibleFor(m,'lkp',config.station,startMs) && ageEligible(m,c) && fs.existsSync(m.mediaPath) && Number.isSafeInteger(m.durationMs) && m.durationMs > 0);
  if(!library.length) throw new Error('No playable age-eligible children programmes; preserve the existing schedule');
  const clips=fillers?.clips ?? readRotationLibrary(config);
  const toleranceMs=(c.boundaryToleranceSeconds ?? 5)*1000;
  const consumed=new Set<string>();
  const result: ScheduleEntry[] = [];
  let cursor = startMs, sequence = initialSequence;
  const history = () => [...previous,...result];
  const catalogueById=new Map(catalogue.map(m=>[m.id,m]));
  const fillerLastUse=new Map<string,number>();
  const useCounts=new Map<string,number>(), lastUses=new Map<string,number>();
  const showAirtime=new Map<string,number>(), languageAirtime=new Map<string,number>();
  let previousShow=previous.at(-1)?.showId;
  const account=(e:ScheduleEntry)=>{
    if(e.presentation?.profile==='ln') return;
    fillerLastUse.set(e.mediaId,e.endsAtMs);
    const sources=e.playoutPlan?.assembly?.sources ?? [{mediaId:e.mediaId,fromMs:0,toMs:e.durationMs}];
    for(const source of sources) {
      const key=`${source.mediaId}:${source.fromMs}`;
      useCounts.set(key,(useCounts.get(key) ?? 0)+1);lastUses.set(source.mediaId,e.endsAtMs);
    }
    const week=DateTime.fromMillis(e.startsAtMs,{zone}).startOf('week').toMillis();
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
    const remaining=until-cursor;
    const eligible=clips.filter(clip=>(!clip.season || clip.season===seasonAt(new Date(cursor))) && fs.existsSync(clip.mediaPath));
    // Prefer useful short programmes above; these finite published films fill the residual.
    const last=result.at(-1)?.mediaId ?? previous.at(-1)?.mediaId;
    const choices=eligible.filter(clip=>clip.durationMs<=remaining+(hard?0:toleranceMs));
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
  const advertisement=(until:number,slot:string,date:string,hard=false):boolean=>{
    if(!config.advertising?.enabled || !config.station?.profiles.lkp.advertising) return false;
    const bumper=fillers?.bumpers.filter(b=>fs.existsSync(b.mediaPath)).sort((a,b)=>a.mediaPath.localeCompare(b.mediaPath))[0];
    if(!bumper) return false;
    const available=(fillers?.ads ?? []).filter(ad=>ad.enabled && /^(?:all(?:-ages)?|children|family|0\+?)$/i.test(ad.ageSuitability ?? '') && fs.existsSync(ad.mediaPath) && (fillerLastUse.get(`ad-${ad.id}`) ?? 0)<=cursor-10*60_000 && ad.durationMs+bumper.durationMs<=until-cursor+(hard?0:toleranceMs));
    available.sort((a,b)=>Math.abs(until-cursor-a.durationMs-bumper.durationMs)-Math.abs(until-cursor-b.durationMs-bumper.durationMs) || a.id.localeCompare(b.id));
    const ad=available[0];if(!ad)return false;
    const durationMs=ad.durationMs+bumper.durationMs,id=stableId(seed,'ad-filler',ad.id,cursor);
    push({id,sequence,mediaId:`ad-${ad.id}`,showId:'lkp-advertising',showTitle:'Werbung',episodeTitle:ad.title,description:ad.title,
      startsAtMs:cursor,endsAtMs:cursor+durationMs,durationMs,mediaPath:bumper.mediaPath,audioLanguage:ad.language,subtitleLanguages:[],listingVisibility:'hidden',presentation:{profile:'lkp',kind:'programme'},
      playoutPlan:{version:1,programmeEventId:id,sourceDurationMs:durationMs,durationMs,segments:[{type:'ad-ident',mediaPath:bumper.mediaPath,durationMs:bumper.durationMs,character:bumper.character},{type:'ad',mediaPath:ad.mediaPath,durationMs:ad.durationMs,adId:ad.id}],warnings:[],assembly:{slot,premiereDate:date,sources:[]}}});return true;
  };
  const make = (showId: string | undefined, until: number, slot: string, premiereDate: string): boolean => {
    const budget = until-cursor;
    const local = DateTime.fromMillis(cursor,{zone}), part = daypart(local.hour+local.minute/60);
    const candidates = library.filter(m => eligibleFor(m,'lkp',config.station,cursor) && (!showId || m.showId===showId) && programmeEligible(m,cursor,zone) && !childrenPolicy(m,c)!.excludedDayparts?.includes(part));
    const week=local.startOf('week').toMillis();
    const spoken=new Map(['de','en','cs'].map(l=>[l,languageAirtime.get(`${week}:${l}`) ?? 0]));
    const total=[...spoken.values()].reduce((a,b)=>a+b,0);
    const score = (m: MediaItem) => {
      const p=childrenPolicy(m,c)!, airtime=(showAirtime.get(`${week}:${m.showId}`) ?? 0)/60_000;
      const language=m.audioLanguage ?? m.defaultLanguage ?? '', targets=config.schedule.spokenLanguageTargets;
      const languageDebt=targets && Object.hasOwn(targets,language) ? ((total+30*60_000)*targets[language as keyof typeof targets]-(spoken.get(language) ?? 0))/3_600_000 : 0;
      return (p.schedulingPriority==='flagship' ? .5 : p.schedulingPriority==='regular' ? .25 : 0) + (p.preferredDayparts[part] ?? 0)*2 + (part==='bedtime' ? p.energyLevel==='calm'?8:p.energyLevel==='high'?-12:0 : 0) +
        Math.max(-3,1-airtime/Math.max(1,p.targetWeeklyAirtimeMinutes))*3 + languageDebt - (previousShow===m.showId ? 4:0);
    };
    const scores=new Map(candidates.map(m=>[m.id,score(m)]));
    const partsById=new Map(candidates.map(m=>[m.id,programmeParts(m,childrenPolicy(m,c)!.preferredSlotDurationMinutes*60_000)]));
    const pending=(m:MediaItem)=>{
      const parts=partsById.get(m.id)!;
      return parts.length>1 && uses(m,parts[0]!.fromMs)>uses(m,parts.at(-1)!.fromMs) ? 1:0;
    };
    candidates.sort((a,b)=> pending(b)-pending(a) || scores.get(b.id)!-scores.get(a.id)! || uses(a)-uses(b) || lastUse(a)-lastUse(b) || programmeOrder(a,b) || stableId(seed,a.id).localeCompare(stableId(seed,b.id)));
    const sources: Source[]=[];
    let remaining=budget;
    for (const m of candidates) {
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
  const fill = (until:number,slot:string,date:string,showId?:string,hard=false) => {
    const limit=Math.min(endMs,until+(hard?0:toleranceMs));
    if (showId) make(showId,limit,slot,date);
    while(cursor<until) {
      if(!hard && until-cursor<=toleranceMs) return;
      const before=cursor;
      if (!make(undefined,Math.min(limit,cursor+30*60_000),slot,date) && !make(undefined,limit,slot,date) &&
          !advertisement(until,slot,date,hard) && !interstitial(until,slot,date,hard)) {
        if(!hard && until-cursor<=toleranceMs) return; // Start the next programme directly, a few seconds early.
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
      const originals=history().filter(e=>e.playoutPlan?.assembly?.slot===active.rerunOf && e.playoutPlan?.assembly?.premiereDate===yesterdayDate && !e.playoutPlan?.assembly?.rerunOf).slice(0,1);
      const sources=originals.flatMap(e=>e.playoutPlan?.assembly?.sources ?? []);
      const compatible=sources.length && sources.every(s=>library.some(m=>m.id===s.mediaId && programmeEligible(m,cursor,zone) && !childrenPolicy(m,c)!.excludedDayparts?.includes(daypart(local.hour+local.minute/60))));
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
