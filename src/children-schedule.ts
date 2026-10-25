import fs from 'node:fs';
import { DateTime } from 'luxon';
import type { AppConfig, MediaItem, ScheduleEntry, PlayoutSegment } from './types.js';
import { ageEligible, childrenPolicy, daypart } from './children-policy.js';
import { eligibleFor } from './channels.js';
import { stationAssets } from './channel-schedule.js';
import { programmeEligible, programmeOrder } from './acquisition/programming.js';
import { isCatalogueMovie } from './catalogue.js';
import { stableId } from './util.js';

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
  initialSequence: number, previous: ScheduleEntry[], config: AppConfig): ScheduleEntry[] {
  const c = config.children!;
  if (!config.station?.enabled) throw new Error('Children clock requires station profile barriers');
  const zone = config.channel.timezone;
  const library = catalogue.filter(m => eligibleFor(m,'lkp',config.station,startMs) && ageEligible(m,c) && fs.existsSync(m.mediaPath) && Number.isSafeInteger(m.durationMs) && m.durationMs > 0);
  const assets = config.station?.enabled ? stationAssets(config) : undefined;
  const continuity = assets?.get('day-continuity');
  const result: ScheduleEntry[] = [];
  let cursor = startMs, sequence = initialSequence;
  const history = () => [...previous,...result];
  const catalogueById=new Map(catalogue.map(m=>[m.id,m]));
  const useCounts=new Map<string,number>(), lastUses=new Map<string,number>();
  const showAirtime=new Map<string,number>(), languageAirtime=new Map<string,number>();
  let previousShow=previous.at(-1)?.showId;
  const account=(e:ScheduleEntry)=>{
    if(e.presentation?.profile==='ln') return;
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
  const gap = (until: number, weather = false) => {
    if (until <= cursor) return;
    if (!continuity) throw new Error('Children clock requires a validated day-continuity asset to fill residual gaps');
    push({ id:stableId(seed,'children-gap',cursor),sequence,mediaId:'station-day-continuity',showId:'station-lkp',showTitle:'Lundenburg Kids Premium',episodeTitle:'Eine kleine Pause',description:'Eine kleine Pause im Programm.',startsAtMs:cursor,endsAtMs:until,durationMs:until-cursor,mediaPath:continuity.path,audioLanguage:'zxx',subtitleLanguages:[],listingVisibility:'public',presentation:{profile:'lkp',kind:'gap',loop:true,...(weather?{block:'weather'}:{})} });
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
  const fill = (until:number,slot:string,date:string,showId?:string) => {
    if (showId) make(showId,until,slot,date);
    while(cursor<until) {
      const before=cursor;
      // A half-hour block keeps regular shows recurring without cutting them.
      if (!make(undefined,Math.min(until,cursor+30*60_000),slot,date) && !make(undefined,until,slot,date)) gap(until);
      if (before===cursor) throw new Error('Children compiler made no progress');
    }
  };
  while(cursor<endMs) {
    const local=DateTime.fromMillis(cursor,{zone}), date=local.toISODate()!, midnight=local.startOf('day');
    const slots=c.slots.filter(s=>!s.weekdays || s.weekdays.includes(local.weekday)).map(s=>({...s,start:midnight.set({hour:Number(s.time.slice(0,2)),minute:Number(s.time.slice(3))}).toMillis()})).sort((a,b)=>a.start-b.start);
    const active=slots.find(s=>s.start===cursor);
    const next=slots.find(s=>s.start>cursor);
    if (!active) { fill(Math.min(endMs,next?.start ?? local.plus({days:1}).startOf('day').toMillis()),'flexible',date); continue; }
    const until=Math.min(endMs,active.start+active.minutes*60_000);
    if(active.showId==='lkp-weather') {gap(until,true);continue;}
    if(active.showId==='weekend-film' && local.weekday===7) active.rerunOf=active.time;
    if(active.rerunOf) {
      const yesterday=local.minus({days:1}).startOf('day').set({hour:Number(active.rerunOf.slice(0,2)),minute:Number(active.rerunOf.slice(3))}).toMillis();
      const originals=history().filter(e=>e.startsAtMs>=yesterday && e.endsAtMs<=yesterday+active.minutes*60_000 &&
        (e.playoutPlan?.assembly?.slot===active.rerunOf || e.showId==='station-lkp'));
      const sources=originals.flatMap(e=>e.playoutPlan?.assembly?.sources ?? []);
      const compatible=sources.length && sources.every(s=>library.some(m=>m.id===s.mediaId && programmeEligible(m,cursor,zone) && !childrenPolicy(m,c)!.excludedDayparts?.includes(daypart(local.hour+local.minute/60))));
      if(compatible && originals[0]?.startsAtMs===yesterday && originals.at(-1)?.endsAtMs===yesterday+active.minutes*60_000 && until===active.start+active.minutes*60_000) {
        for(const old of originals) {
          const id=stableId(seed,'rerun',old.id,active.start), plan=old.playoutPlan;
          const {epgEventId:_epg,...base}=old;
          push({...base,id,sequence,startsAtMs:cursor,endsAtMs:cursor+old.durationMs,...(plan?{playoutPlan:{...plan,programmeEventId:id,assembly:{...plan.assembly!,slot:active.time,rerunOf:old.id}}}:{})});
        }
        continue;
      }
    }
    if(active.showId==='weekend-film') {
      const film=library.filter(m=>isCatalogueMovie(m) && m.durationMs<=until-cursor).sort((a,b)=>lastUse(a)-lastUse(b) || programmeOrder(a,b))[0];
      fill(until,active.time,date,film?.showId);continue;
    }
    const show=active.olderShowId && c.targetAgeYears>=6 ? active.olderShowId : active.showId;
    fill(until,active.time,date,show);
  }
  return result;
}
