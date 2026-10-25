import crypto from 'node:crypto';
import fs from 'node:fs';
import type { AppConfig, MediaItem, ScheduleEntry } from './types.js';
import { eligibleFor, mediaPolicy, profileWindow } from './channels.js';
import { programmeOrder } from './acquisition/programming.js';
import { isCatalogueMovie } from './catalogue.js';
import { stableId } from './util.js';
import { DateTime } from 'luxon';

export interface PresentationAsset { id: string; path: string; durationMs: number; fullScreen: boolean; destination: string }
export function stationAssets(config: AppConfig): Map<string, PresentationAsset> {
  const file = config.station?.assetManifest;
  if (!file || !fs.existsSync(file)) throw new Error('LN presentation assets have not been activated');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.version !== 1 || manifest.status !== 'ready' || manifest.fps !== config.video.fps || !Array.isArray(manifest.assets)) throw new Error('Invalid station presentation manifest');
  const assets = new Map<string, PresentationAsset>();
  for (const a of manifest.assets as PresentationAsset[]) {
    if (assets.has(a.id) || !Number.isSafeInteger(a.durationMs) || a.durationMs <= 0 || !a.fullScreen || !fs.existsSync(a.path)) throw new Error('Missing or invalid station presentation asset');
    assets.set(a.id, a);
  }
  for (const id of ['evening', 'morning', 'ident', 'outro', 'continuity', 'day-continuity']) if (!assets.has(id)) throw new Error(`Missing station asset: ${id}`);
  return assets;
}

export interface RotationRecord { mediaId: string; count: number; lastAtMs: number }
export interface ProfilePlanning {
  onProgress?: (progress:{date:string;events:number;completedDays:number;totalDays:number;elapsedMs:number})=>void; config: AppConfig; history?: RotationRecord[]; reserved?: ScheduleEntry[];
}
export type DayPlanner = (startMs: number, endMs: number, sequence: number, previous: ScheduleEntry[]) => ScheduleEntry[];
const blockFor = (category: string) => ({ news: 'aktuell', science: 'neugierig', education: 'neugierig', regional: 'heimat', calm: 'nachtruhe',
  history: 'geschichte', society: 'geschichte', comedy: 'internet', sitcom: 'feierabend', movie: 'kino', family: 'kino' }[category] ?? 'neugierig');
const genreFor = (category: string) => ({ news: 0x20, science: 0x90, education: 0x90, regional: 0x80, calm: 0x91,
  history: 0x92, society: 0x80, comedy: 0x14, sitcom: 0x14, movie: 0x10, family: 0x10 }[category] ?? 0x90);
const shuffle = (seed: string, id: string) => crypto.createHash('sha256').update(`${seed}:${id}`).digest('hex');

/** The one station timeline is partitioned at civil-time profile barriers. */
export function buildProfileSchedule(catalogue: MediaItem[], seed: string, startMs: number, targetEndMs: number,
  initialSequence: number, previousEntries: ScheduleEntry[], planning: ProfilePlanning, dayPlanner: DayPlanner): ScheduleEntry[] {
  const { config } = planning, station = config.station!;
  catalogue=catalogue.filter(m=>Number.isSafeInteger(m.durationMs)&&m.durationMs>0&&fs.existsSync(m.mediaPath));
  const started=performance.now();let progressDate='';
  const totalDays=Math.ceil((targetEndMs-startMs)/86400000);
  const hashes=new Map(catalogue.map(m=>[m.id,shuffle(seed,m.id)]));
  const randomKey=(id:string)=>hashes.get(id)!;
  let dayHistory=previousEntries.filter(e=>e.presentation?.profile!=='ln' && e.endsAtMs>=startMs-14*86400000);
  const assets = stationAssets(config), result: ScheduleEntry[] = [];
  let cursor = startMs, sequence = initialSequence;
  const count = new Map<string, number>(), last = new Map<string, number>();
  for (const r of planning.history ?? []) { count.set(r.mediaId, r.count); last.set(r.mediaId, r.lastAtMs); }
  const availableNight=(m:MediaItem,at:number)=>eligibleFor(m,'ln',station,at) && (!station.minimumMovieRepeatHours || !isCatalogueMovie(m) || (last.get(m.id)??0)<=at-station.minimumMovieRepeatHours*3600_000);
  const previousEntry=(entries:ScheduleEntry[],id:string)=>{for(let i=entries.length-1;i>=0;i--)if(entries[i]!.mediaId===id)return entries[i];return undefined;};
  const now = Date.now();
  for (const e of previousEntries) if ((!planning.history || e.startsAtMs >= now) && e.presentation?.kind === 'programme' && e.presentation.profile === 'ln') {
    count.set(e.mediaId, (count.get(e.mediaId) ?? 0) + 1); last.set(e.mediaId, e.startsAtMs);
  }
  const push = (e: ScheduleEntry) => { result.push(e);if(e.presentation?.block==='aktuell' && e.presentation.kind==='programme')newsWindows.add(profileWindow(e.startsAtMs,station).startsAtMs);if(e.presentation?.profile==='lkp')dayHistory.push(e); cursor = e.endsAtMs; sequence = e.sequence + 1; };
  const continuity = (id: string, profile: 'lkp' | 'ln', kind: 'handover' | 'ident' | 'intro' | 'outro' | 'gap', durationMs?: number, block?: string) => {
    const asset = assets.get(id) ?? assets.get('ident')!;
    const duration = durationMs ?? asset.durationMs;
    if(station.avoidHandoverLogoPadding && kind==='gap' && duration>5000)throw new Error('Static station logo cannot exceed five seconds');
    push({ id: stableId(seed, sequence, id, cursor), sequence, mediaId: `station-${id}`, showId: `station-${profile}`,
      showTitle: station.profiles[profile].name, episodeTitle: kind === 'gap' ? profile === 'ln' ? 'Nachtbilder' : 'Eine kleine Pause' : profile === 'ln' ? 'Lundenburg Nacht' : 'Guten Morgen, Lundenburg!',
      description: kind === 'handover' ? `Programmbeginn ${station.profiles[profile].name}.` : 'Eine kleine Pause im Programm.',
      startsAtMs: cursor, endsAtMs: cursor + duration, durationMs: duration, mediaPath: asset.path,
      subtitleLanguages: [], audioLanguage: 'zxx', listingVisibility: kind === 'handover' || kind === 'gap' ? 'public' : 'hidden',
      presentation: { profile, kind, ...(block ? { block } : {}), ...(kind === 'gap' ? { loop: true } : {}) } });
  };
  const reserved = [...(planning.reserved ?? [])].filter(e => e.startsAtMs >= startMs).sort((a, b) => a.startsAtMs - b.startsAtMs);
  const newsWindows=new Set(previousEntries.filter(e=>e.presentation?.block==='aktuell').map(e=>profileWindow(e.startsAtMs,station).startsAtMs));
  const collections=new Map<string,MediaItem[]>();
  for(const m of catalogue){const group=collections.get(m.showId)??[];group.push(m);collections.set(m.showId,group);}
  const series=new Map<string,MediaItem[]>();
  for(const m of catalogue){const p=mediaPolicy(m,station);if(m.enabled && p.seriesId && p.seriesOrder!==undefined){const group=series.get(p.seriesId)??[];group.push(m);series.set(p.seriesId,group);}}
  for(const group of series.values())group.sort((a,b)=>mediaPolicy(a,station).seriesOrder!-mediaPolicy(b,station).seriesOrder!);
  let nightStart=0,nightWindow=0;
  let previousShow = previousEntries.at(-1)?.showId;
  let plannedTail:MediaItem[]=[];
  timeline: while (cursor < targetEndMs) {
    const window = profileWindow(cursor, station), windowEnd = window.endsAtMs;
    const day=DateTime.fromMillis(cursor,{zone:station.timezone}).toISODate()!;
    if(day!==progressDate){progressDate=day;planning.onProgress?.({date:day,events:result.length,completedDays:Math.max(0,Math.round(DateTime.fromMillis(cursor,{zone:station.timezone}).startOf('day').diff(DateTime.fromMillis(startMs,{zone:station.timezone}).startOf('day'),'days').days)),totalDays,elapsedMs:Math.round(performance.now()-started)});}
    if (cursor === window.startsAtMs) continuity(window.profile === 'ln' ? 'evening' : 'morning', window.profile, 'handover');
    if (window.profile === 'lkp') {
      const special = reserved.find(e => e.startsAtMs >= cursor && e.startsAtMs < windowEnd);
      const end = Math.min(special?.startsAtMs ?? windowEnd, targetEndMs);
      dayHistory=dayHistory.filter(e=>e.endsAtMs>=cursor-14*86400000);
      const previous=dayHistory;
      const entries = dayPlanner(cursor, end, sequence, previous);
      for (const e of entries) push({ ...e, presentation: e.presentation ?? { profile: 'lkp', kind: e.listingVisibility === 'hidden' ? 'ident' : 'programme' } });
      if (cursor < end) continuity('day-continuity', 'lkp', 'gap', end - cursor);
      if (special && cursor === special.startsAtMs && cursor < targetEndMs) {
        if (special.endsAtMs > windowEnd) throw new Error('Published weather would cross a channel boundary');
        push({ ...special, sequence, presentation: { profile: 'lkp', kind: 'programme' } });
      }
      continue;
    }
    if(nightWindow!==window.startsAtMs){nightWindow=window.startsAtMs;nightStart=result.length;}
    const earlierCounts=new Map<string,number>();
    for(const group of series.values()){let minimum=Infinity,index=0;while(index<group.length){let next=index+1;const order=mediaPolicy(group[index]!,station).seriesOrder;while(next<group.length&&mediaPolicy(group[next]!,station).seriesOrder===order)next++;for(let i=index;i<next;i++)earlierCounts.set(group[i]!.id,minimum);for(let i=index;i<next;i++)minimum=Math.min(minimum,count.get(group[i]!.id)??0);index=next;}}
    const minimumCounts=new Map<string,number>();
    const collectionMinimum=(id:string)=>{if(!minimumCounts.has(id))minimumCounts.set(id,Math.min(...(collections.get(id)??[]).filter(o=>eligibleFor(o,'ln',station,cursor)).map(o=>count.get(o.id)??0)));return minimumCounts.get(id)!;};
    const newsAt = window.startsAtMs + station.newsOffsetMinutes * 60_000;
    const newsScheduled=newsWindows.has(window.startsAtMs);
    const news = catalogue.filter(m => availableNight(m,cursor) && mediaPolicy(m, station).retention === 'latest-only')
      .sort((a, b) => publication(b) - publication(a) || a.id.localeCompare(b.id))[0];
    // If a restart or guarded rebuild happens after the preferred first block,
    // still carry one latest bulletin in this overnight window. A committed
    // bulletin above prevents a duplicate when the future tail is regenerated.
    const newsDue = !newsScheduled && cursor >= newsAt && cursor < windowEnd;
    const beforeNews = !newsScheduled && cursor < newsAt;
    const quiet = DateTime.fromMillis(cursor, { zone: station.timezone }).hour >= 2 && DateTime.fromMillis(cursor, { zone: station.timezone }).hour < 6;
    const cutoff = beforeNews ? Math.min(newsAt, windowEnd) : windowEnd;
    const budget = cutoff - cursor;
    const bumperMs = (assets.get('intro-neugierig')?.durationMs ?? 0) + assets.get('outro')!.durationMs;
    const eligible = catalogue.filter(m => {
      if (!availableNight(m,cursor) || m.durationMs + bumperMs > budget || !Number.isSafeInteger(m.durationMs) || m.durationMs <= 0) return false;
      const p = mediaPolicy(m, station);
      if (!station.profiles.ln.languages.includes(m.audioLanguage ?? m.defaultLanguage ?? 'unknown') || !station.profiles.ln.categories.includes(p.category)) return false;
      if (p.retention === 'latest-only') return newsDue && m.id === news?.id;
      if (quiet && (p.intensity !== 'calm' || p.timeOfNight === 'evening')) return false;
      if (p.timeOfNight === 'quiet' && !quiet) return false;
      // A multipart sequence cannot jump over an earlier unplayed part to fill a gap.
      if(p.seriesId && p.seriesOrder!==undefined && (earlierCounts.get(m.id)??Infinity)<=(count.get(m.id)??0))return false;
      return true;
    });
    const hour = DateTime.fromMillis(cursor, { zone: station.timezone }).hour;
    const preference = quiet ? ['calm', 'regional', 'movie', 'education'] : hour >= 23 || hour < 2
      ? ['history', 'society', 'regional', 'science', 'comedy', 'education', 'movie', 'family']
      : ['science', 'education', 'comedy', 'regional', 'history', 'society', 'movie', 'family'];
    eligible.sort((a, b) => {
      const pa = mediaPolicy(a, station), pb = mediaPolicy(b, station);
      if (newsDue && (a.id === news?.id || b.id === news?.id)) return a.id === news?.id ? -1 : 1;
      const ca = count.get(a.id) ?? 0, cb = count.get(b.id) ?? 0;
      return (a.showId === previousShow ? 1 : 0) - (b.showId === previousShow ? 1 : 0) ||
        ca - cb || preference.indexOf(pa.category) - preference.indexOf(pb.category) ||
        (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0) ||
        (a.showId === b.showId && station.rotation === 'sequential' ? programmeOrder(a, b) : randomKey(a.id).localeCompare(randomKey(b.id)));
    });
    // Fair collection rotation is stricter than generic programme diversity.
    let selected = plannedTail.shift() ?? eligible.find(m => {
      if (mediaPolicy(m, station).retention !== 'protected') return true;
      return (count.get(m.id)??0)<=collectionMinimum(m.showId);
    });
    // The news offset is a preference, not a reason to hold a static station card.
    if (station.avoidHandoverLogoPadding && !selected && beforeNews && news && news.durationMs+bumperMs<=windowEnd-cursor) selected=news;
    // Near dawn, use an intact independent short rather than hours/minutes of the logo loop.
    // Narrative multipart order is retained; independent comedy collections can fill by duration.
    if (station.avoidHandoverLogoPadding && !selected && !beforeNews && windowEnd-cursor<=30*60_000) {
      const shorts=catalogue.filter(m=>{
        if(!availableNight(m,cursor) || m.durationMs+bumperMs>windowEnd-cursor || m.durationMs<=0) return false;
        const p=mediaPolicy(m,station);
        if(!station.profiles.ln.languages.includes(m.audioLanguage ?? m.defaultLanguage ?? 'unknown') || !station.profiles.ln.categories.includes(p.category) || (p.timeOfNight==='evening' && p.category!=='comedy') || p.retention==='latest-only') return false;
        if(p.seriesId && p.seriesOrder!==undefined && p.category!=='comedy') return false;
        if(p.retention==='protected') {
          if((count.get(m.id)??0)>collectionMinimum(m.showId))return false;
        }
        return true;
      });
      shorts.sort((a,b)=>b.durationMs-a.durationMs || (count.get(a.id) ?? 0)-(count.get(b.id) ?? 0) || randomKey(a.id).localeCompare(randomKey(b.id)));
      selected=shorts[0];
    }
    if (!selected) {
      // A finite animated ident can bridge a few frames/seconds; never loop a static card beside a handover.
      const ident=assets.get('ident')!;
      if(station.avoidHandoverLogoPadding && windowEnd-cursor<=Math.min(5000,ident.durationMs)) {continuity('ident','ln','ident',windowEnd-cursor);continue;}
      if(station.avoidHandoverLogoPadding && windowEnd-cursor<=30*60_000) {
        // Refit the last uncommitted programme block so a short is not stranded
        // behind an otherwise suitable long documentary. All sources stay intact.
        let newsEnd=window.startsAtMs;for(let i=nightStart;i<result.length;i++)if(result[i]!.presentation?.block==='aktuell')newsEnd=result[i]!.endsAtMs;
        const programmeIndices:number[]=[];for(let i=nightStart;i<result.length;i++)if(result[i]!.presentation?.kind==='programme' && result[i]!.startsAtMs>=newsEnd)programmeIndices.push(i);
        for(let back=1;back<=Math.min(12,programmeIndices.length);back++) {
        const lastProgramme=programmeIndices.at(-back) ?? -1;
        if(lastProgramme>=0) {
          const first=lastProgramme>0 && result[lastProgramme-1]?.presentation?.kind==='intro' ? lastProgramme-1:lastProgramme;
          const from=result[first]!.startsAtMs;
          const withdrawn=new Map<string,number>();
          for(let i=first;i<result.length;i++)if(result[i]!.presentation?.kind==='programme')withdrawn.set(result[i]!.mediaId,(withdrawn.get(result[i]!.mediaId)??0)+1);
          const effectiveCount=(id:string)=>Math.max(0,(count.get(id)??0)-(withdrawn.get(id)??0));
          const refitMinimums=new Map<string,number>();
          const refitMinimum=(id:string)=>{if(!refitMinimums.has(id))refitMinimums.set(id,Math.min(...(collections.get(id)??[]).filter(o=>eligibleFor(o,'ln',station,from)).map(o=>effectiveCount(o.id))));return refitMinimums.get(id)!;};
          const pool=catalogue.filter(m=>{
            const p=mediaPolicy(m,station);
            if(!availableNight(m,from) || !fs.existsSync(m.mediaPath) || p.retention==='latest-only' || (p.timeOfNight==='evening' && p.category!=='comedy') || (p.intensity!=='calm' && p.category!=='comedy')) return false;
            if(p.seriesId && p.seriesOrder!==undefined && p.category!=='comedy') return false;
            if(p.retention==='protected') {
              if(effectiveCount(m.id)>refitMinimum(m.showId))return false;
            }
            return station.profiles.ln.languages.includes(m.audioLanguage ?? m.defaultLanguage ?? 'unknown') && station.profiles.ln.categories.includes(p.category);
          });
          pool.sort((a,b)=>(mediaPolicy(a,station).intensity==='calm'?0:1)-(mediaPolicy(b,station).intensity==='calm'?0:1) || effectiveCount(a.id)-effectiveCount(b.id) || randomKey(a.id).localeCompare(randomKey(b.id)));
          const cost=(m:MediaItem)=>m.durationMs+(assets.get(`intro-${blockFor(mediaPolicy(m,station).category)}`)?.durationMs ?? 0)+assets.get('outro')!.durationMs;
          const plan=fitNightTail(pool,windowEnd-from,Math.min(5000,ident.durationMs),cost);
          if(plan) {
            const removed=result.splice(first);
            for(const e of removed.filter(e=>e.presentation?.kind==='programme')) {
              count.set(e.mediaId,Math.max(0,(count.get(e.mediaId) ?? 0)-1));
              const prior=previousEntry(result,e.mediaId)??previousEntry(previousEntries,e.mediaId);
              last.set(e.mediaId,prior?.startsAtMs ?? planning.history?.find(p=>p.mediaId===e.mediaId)?.lastAtMs ?? 0);
            }
            cursor=from;sequence=removed[0]!.sequence;plannedTail=plan;previousShow=result.at(-1)?.showId;continue timeline;
          }
        }
      }
      }
      if(station.avoidHandoverLogoPadding && (cursor<=window.startsAtMs+15*60_000 || windowEnd-cursor<=30*60_000)) throw new Error(`No intact LN short fits beside the handover at ${new Date(cursor).toISOString()} (${windowEnd-cursor} ms remaining); refusing static logo padding`);
      continuity('continuity', 'ln', 'gap', budget);continue;
    }
    const policy = mediaPolicy(selected, station), block = blockFor(policy.category);
    const intro = assets.get(`intro-${block}`);
    if (intro) continuity(intro.id, 'ln', 'intro', undefined, block);
    const publicationDate = publication(selected) ? DateTime.fromMillis(publication(selected), { zone: station.timezone }).toISODate()! : undefined;
    const description = policy.retention === 'latest-only' && publicationDate
      ? `${selected.description} Originalveröffentlichung: ${publicationDate}.` : selected.description;
    push({ id: stableId(seed, sequence, selected.id, cursor), sequence, mediaId: selected.id, showId: selected.showId,
      showTitle: block === 'aktuell' ? 'Lundenburg Aktuell' : selected.showTitle, episodeTitle: selected.episodeTitle, description,
      ...(selected.season !== undefined ? { season: selected.season } : {}), ...(selected.episode !== undefined ? { episode: selected.episode } : {}),
      startsAtMs: cursor, endsAtMs: cursor + selected.durationMs, durationMs: selected.durationMs, mediaPath: selected.mediaPath,
      ...(selected.audioLanguage ? { audioLanguage: selected.audioLanguage } : {}), subtitleLanguages: [...new Set(selected.subtitles.map(s => s.language))],
      listingVisibility: 'public', presentation: { profile: 'ln', kind: 'programme', block, genre: genreFor(policy.category), ...(publicationDate ? { publicationDate } : {}) } });
    count.set(selected.id, (count.get(selected.id) ?? 0) + 1); last.set(selected.id, cursor); previousShow = selected.showId;
    continuity('outro', 'ln', 'outro', undefined, block);
  }
  planning.onProgress?.({date:DateTime.fromMillis(cursor,{zone:station.timezone}).toISODate()!,events:result.length,completedDays:totalDays,totalDays,elapsedMs:Math.round(performance.now()-started)});
  return result;
}
function publication(m: MediaItem): number { return Number((m.technical.acquisition as { publishedAt?: number } | undefined)?.publishedAt ?? 0); }

/** Fit distinct whole programmes to the handover using bounded bitset reachability. */
export function fitNightTail(pool:MediaItem[],budget:number,tolerance:number,cost:(m:MediaItem)=>number):MediaItem[]|undefined {
  const sorted=[...pool].sort((a,b)=>cost(a)-cost(b) || a.id.localeCompare(b.id));
  const finish=(remaining:number,excluded:Set<string>)=>{
    let low=0,high=sorted.length;
    while(low<high) {const mid=(low+high)>>>1;if(cost(sorted[mid]!)<=remaining)low=mid+1;else high=mid;}
    for(let i=low-1;i>=0 && remaining-cost(sorted[i]!)<=tolerance;i--) if(!excluded.has(sorted[i]!.id)) return sorted[i];
    return undefined;
  };
  for(const a of pool) {
    const left=budget-cost(a);if(left<0)continue;
    if(left<=tolerance)return [a];
    const b=finish(left,new Set([a.id]));if(b)return [a,b];
  }
  // Quantized subset reachability uses word shifts, not a combinatorial search.
  // Reconstruct original millisecond costs and accept only an exact safe fit;
  // rounding never changes programme durations or the handover deadline.
  const maxUnits=Math.ceil(budget/1000)+32;
  const words=Math.ceil((maxUnits+1)/32),bits=new Uint32Array(words);bits[0]=1;
  const before:Uint32Array[]=[],units:number[]=[];
  for(const m of pool) {
    before.push(bits.slice());const amount=Math.max(1,Math.round(cost(m)/1000));units.push(amount);
    const whole=amount>>>5,part=amount&31;
    if(amount>maxUnits)continue;
    for(let i=words-1;i>=whole;i--) {
      const high=bits[i-whole]!<<part;
      const low=part && i>whole ? bits[i-whole-1]!>>>(32-part):0;
      bits[i]=bits[i]!|high|low;
    }
  }
  const has=(set:Uint32Array,n:number)=>n>=0 && n<=maxUnits && Boolean(set[n>>>5]!&(1<<(n&31)));
  const middle=Math.round(budget/1000);
  for(let delta=0;delta<=32;delta++)for(const target of delta?[middle+delta,middle-delta]:[middle]) {
    if(!has(bits,target))continue;
    let left=target;const picked:MediaItem[]=[];
    for(let i=pool.length-1;i>=0 && left>0;i--) {
      if(has(before[i]!,left))continue;
      if(has(before[i]!,left-units[i]!)){picked.push(pool[i]!);left-=units[i]!;}
    }
    const remainder=budget-picked.reduce((sum,m)=>sum+cost(m),0);
    if(left===0 && picked.length && remainder>=0 && remainder<=tolerance)return picked.reverse();
  }
  return undefined;
}
