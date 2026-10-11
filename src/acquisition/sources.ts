import type { Candidate, Subscription } from './model.js';
import { ClassificationApiError } from './classification.js';
import { normalize, urlIdentity } from './model.js';
import { stableId } from '../util.js';
export async function fetchText(url: string, init: RequestInit = {}, maxBytes = 4*1024*1024) : Promise<string> {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
        if (new URL(url).hostname === 'api.openai.com') {
            let code;
            try { code = (await response.json()).error?.code; } catch {}
            const quota = ['insufficient_quota', 'credit_balance_exhausted'].includes(code);
            throw new ClassificationApiError(response.status, quota ? 'quota' : response.status === 429 ? 'rate-limit' : [401,403].includes(response.status) ? 'authentication' : 'service');
        }
        throw new Error(`Source HTTP ${response.status}`);
    }
    if (!(response.body as unknown))
        throw new Error('Empty source response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of (response.body as unknown as AsyncIterable<Uint8Array>)) {
        size += chunk.length;
        if (size > maxBytes)
            throw new Error('Source response too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}
export function normalizeMediathek(row: Record<string,unknown>, s: Subscription): Candidate | undefined {
  const topic = normalize(String(row.topic ?? ''));
  // Never accept loose search hits, especially names in news reports.
  if (![s.title,...s.aliases].some(alias => topic === normalize(alias))) return undefined;
  const title = String(row.title ?? '').trim(); if (!title) return undefined;
  const downloadUrl = String(row.url_video_hd || row.url_video || '');
  const sourceUrl = String(row.url_website || downloadUrl); if (!sourceUrl) return undefined;
  if(s.language==='de'&&/\b(?:sorbisch|obersorbisch|niedersorbisch|sorbian)\b/i.test(title))return undefined;
  const numbers = /\bS(\d+)E(\d+)\b/i.exec(title);
  const episode = numbers ? Number(numbers[2]) : /(?:Folge\s*|\()(\d+)(?:\/\d+)?\)?/i.exec(title)?.[1];
  return {
    source:'mediathek',sourceId:stableId(urlIdentity(sourceUrl)),sourceUrl:urlIdentity(sourceUrl),showId:s.id,title,
    language:s.language,description:String(row.description ?? ''),descriptionLanguage:'de',durationMs:Number(row.duration)*1000,
    // HD can be substantially larger than the API's SD size. HEAD supplies actual bytes before downloading.
    size:Math.max(Number(row.size)||0, Number(row.duration)*1_500_000),broadcaster:String(row.channel ?? ''),
    publishedAt:Number(row.timestamp)*1000, ...(row.expires ? {expiresAt:Date.parse(String(row.expires))} : {}),
    ...(numbers ? {season:Number(numbers[1])} : episode && s.id==='sendung-mit-dem-elefanten' ? {season:1} : {}), ...(episode ? {episode:Number(episode)} : {}),
    ...(downloadUrl ? {downloadUrl} : {}), ...(row.url_subtitle ? {subtitleUrl:String(row.url_subtitle)} : {}),
    components:explicitComponents(String(row.description??'')),compilation:/\b(XXL|compilation|zusammenstellung|best.of|sammlung)\b/i.test(title),
    format:'episode',available:Boolean(downloadUrl),
  };
}
export function explicitComponents(description:string):string[] {
  const keys:string[]=[];
  for(const match of description.matchAll(/(?:^|[\n;])\s*(Bobo Siebenschläfer|Bobo|Meine Schmusedecke|Pittiplatsch|Kalli|Jan\s*(?:&|und)\s*Henry)\s*:\s*([^\n;.!]+)[.!]?/gi)) {
    const name=normalize(match[1]!),title=normalize(match[2]!);
    if(title.length<5)continue;
    if(name==='bobo'||name==='bobo siebenschlaefer') keys.push(`bobo-siebenschlaefer:de:title:${title}`);
    else keys.push(`unser-sandmaennchen:de:title:${name} ${title}`);
  }
  return keys;
}
export async function mediathek(s: Subscription, limit: number): Promise<Candidate[]> {
  const result = new Map<string,Candidate>();
  for (const query of s.queries) {
    for (let offset=0;offset<limit;offset+=100) {
      const data=JSON.parse(await fetchText('https://mediathekviewweb.de/api/query',{
        method:'POST',headers:{'Content-Type':'text/plain','User-Agent':'LKP-content-acquisition/1.0'},
        body:JSON.stringify({queries:[{fields:['topic','title'],query}],sortBy:'timestamp',sortOrder:'desc',future:false,offset,size:Math.min(100,limit-offset)}),
      })) as {result?:{results?:Array<Record<string,unknown>>};err?:unknown};
      if (data.err || !data.result?.results) throw new Error('Mediathek API schema/error');
      for (const row of data.result.results) { const c=normalizeMediathek(row,s); if(c)result.set(c.sourceId,c); }
      if(data.result.results.length<Math.min(100,limit-offset))break;
    }
  }
  return [...result.values()];
}
const strip = (s:string) => s.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(?:39|x27);/g,"'").replace(/\s+/g,' ').trim();
export function ctCards(html:string, base:string, s:Subscription): Candidate[] {
  const root=new URL(base), prefix=root.pathname;
  const result = new Map<string,Candidate>();
  for(const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href=match[1]!, body=match[2]!;
    if (!href.startsWith(prefix) || !/^\d+\/?$/.test(href.slice(prefix.length))) continue;
    const sourceId=href.slice(prefix.length).replace(/\/$/,'');
    const title=strip(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(body)?.[1] ?? '');
    if(!title)continue;
    const duration=Number(/(?:Stopáž[^<]*(?:<[^>]+>)*|videoDuration[^>]*>[^<]*<[^>]+>[^<]*<\/[^>]+>)\s*(\d+)[\s\u00a0]*min/.exec(body)?.[1] ?? /([0-9]+)[\s\u00a0]*min/.exec(strip(body))?.[1]);
    const ep=/^(\d+)\s*\/\s*\d+\s*/.exec(title);
    const seasonText=strip(body).match(/\b(III|II|IV|I|V)\.\s*řada/i)?.[1];
    const season=seasonText?({I:1,II:2,III:3,IV:4,V:5}[seasonText.toUpperCase() as 'I']):undefined;
    const expiryText=strip(body).match(/Dostupné ještě\s+(\d+)\s+(?:dn|hod)[^ ]*/i)?.[0];
    result.set(sourceId,{source:'ct',sourceId,sourceUrl:new URL(href,root).toString(),showId:s.id,
      title:title.replace(/^\d+\s*\/\s*\d+\s*/,''),language:s.language,...(ep?{episode:Number(ep[1])}:{}),...(season?{season}:{}),...(expiryText?{expiryText}:{}),
      description:strip(/<p[^>]*>([\s\S]*?)<\/p>/.exec(body)?.[1] ?? ''),descriptionLanguage:'cs',
      durationMs:duration*60_000,size:duration*60*1_500_000,broadcaster:'ČT',components:[],compilation:false,
      format:'episode',available:body.includes('icon-playable')});
  }
  return [...result.values()];
}
export function ctGraphCandidate(row:Record<string,unknown>,base:string,s:Subscription,card?:Candidate):Candidate|undefined {
  const showId=new URL(base).pathname.split('/')[2]?.split('-')[0];
  if(String(row.showId)!==showId||!/^\d+$/.test(String(row.id)))return undefined;
  const title=String(row.title??'').trim();if(!title)return undefined;
  const episode=/^(\d+)\s*\/\s*\d+\s*/.exec(title);
  const seasonTitle=String((row.season as {title?:string}|null)?.title??'');
  const seasonNumber=/^(\d+)\.?/.exec(seasonTitle)?.[1];
  return {...(card??{}),source:'ct',sourceId:String(row.id),sourceUrl:new URL(`${row.id}/`,base).toString(),showId:s.id,
    title:title.replace(/^\d+\s*\/\s*\d+\s*/,''),language:s.language,...(episode?{episode:Number(episode[1])}:{}),
    ...(seasonNumber?{season:Number(seasonNumber)}:{}),description:String(row.description??''),descriptionLanguage:'cs',
    durationMs:Number(row.duration)*1000,size:Number(row.duration)*1_500_000,broadcaster:'ČT',components:[],compilation:false,
    format:'episode',available:row.playable===true};
}
export async function ceskaTelevize(s:Subscription, limit:number): Promise<Candidate[]> {
  const result = new Map<string,Candidate>();
  for(const base of s.urls) {
    const html=await fetchText(base),cards=ctCards(html,base,s);
    for(const c of cards)result.set(c.sourceId,c);
    const next=/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
    if(!next)throw new Error('ČT programme metadata schema changed');
    const data=JSON.parse(next),show=data.props?.pageProps?.data?.show;
    if(!show||!/^\d+$/.test(String(show.idec)))throw new Error('ČT programme identity unavailable');
    // This is the public API used by the broadcaster's own episode browser.
    // The HTML exposes only ten cards; query approved programme identity explicitly.
    for(let offset=0;offset<limit;offset+=100) {
      const count=Math.min(100,limit-offset);
      const query=`query { episodesPreviewFind(idec: ${JSON.stringify(String(show.idec))}, limit: ${count}, offset: ${offset}, onlyPlayable: false, orderBy: oldest) { totalCount items { id title description duration playable showId season { id title } } } }`;
      const response=JSON.parse(await fetchText('https://api.ceskatelevize.cz/graphql/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})}));
      const page=response.data?.episodesPreviewFind;
      if(response.errors||!Array.isArray(page?.items))throw new Error('ČT episode API unavailable/schema changed');
      for(const row of page.items) {const c=ctGraphCandidate(row,base,s,result.get(String(row.id)));if(c)result.set(c.sourceId,c);}
      if(page.items.length<count||offset+count>=page.totalCount)break;
    }
  }
  return [...result.values()].slice(0,limit);
}
export async function austrianDiscovery(limit:number): Promise<Array<{topic:string;title:string;sourceUrl:string}>> {
  const data=JSON.parse(await fetchText('https://mediathekviewweb.de/api/query',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({queries:[{fields:['channel'],query:'ORF'},{fields:['topic','title','description'],query:'Kinder'}],sortBy:'timestamp',sortOrder:'desc',future:false,offset:0,size:Math.min(limit,100)})}));
  return (data.result?.results ?? []).map((r:Record<string,unknown>)=>({topic:String(r.topic),title:String(r.title),sourceUrl:String(r.url_website)}));
}
