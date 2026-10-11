import type { MediaItem, SubtitleTrack } from '../types.js';
import type { Candidate, Subscription } from './model.js';
export type SubtitleBudget = (kind:'search'|'download')=>boolean;
export interface SubdlMatch { language:string; id:string; url:string; releaseName:string; fps?:number }
import path from 'node:path';
import { normalize } from './model.js';
import { normalizeLanguage } from '../util.js';
const language=(value:unknown):string|undefined=>({english:'en',german:'de',czech:'cs'}[String(value).toLowerCase()]??normalizeLanguage(String(value)));
export function matchSubdl(data:Record<string,any>,item:MediaItem,c:Candidate,s:Subscription|undefined):SubdlMatch[] {
  const match=data.match;
  if(data.status!==true||!match||match.engine!=='local'||match.confidence!=='high'||match.degraded||match.full_season||match.type!=='tv')return [];
  if(c.season===undefined||c.episode===undefined||Number(match.season)!==c.season||Number(match.episode)!==c.episode)return [];
  const result=Array.isArray(data.results)?data.results[0]:undefined;
  const ids=item.externalIds??{};
  const hasId=Boolean(ids.imdb||ids.tmdb);
  const idMatch=Boolean((ids.imdb&&String(result?.imdb_id)===ids.imdb)||(ids.tmdb&&String(result?.tmdb_id)===ids.tmdb));
  if(hasId&&!idMatch)return [];
  const names=[item.showTitle,s?.title,...(s?.aliases??[])].filter((n):n is string=>Boolean(n)).map(normalize);
  if(!hasId&&!names.includes(normalize(String(match.title??''))))return [];
  const tracks:SubdlMatch[]=[];
  for(const row of Array.isArray(data.subtitles)?data.subtitles:[]){
    const lang=language(row.language??row.lang);
    if(!lang||!['de','cs','en'].includes(lang)||item.subtitles.some(t=>t.language===lang)||Number(row.match_score)<.8||!Number.isFinite(Number(row.match_score)))continue;
    if(row.season!==undefined&&Number(row.season)!==c.season)continue;
    if(row.episode!==undefined&&Number(row.episode)!==c.episode)continue;
    const id=String(row.n_id??row.nId??'');
    const release=String(row.release_name??'');
    if(!release)continue;
    let url:string;
    if(/^[a-zA-Z0-9_-]+$/.test(id))url=`https://api.subdl.com/api/v2/subtitles/${encodeURIComponent(id)}/download?format=file`;
    else{
      try{const raw=new URL(String(row.url??''),'https://dl.subdl.com');
        // Accept raw per-file links only. Never guess a file inside a ZIP pack.
        if(raw.protocol!=='https:'||raw.hostname!=='dl.subdl.com'||!/^\/subtitle\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(raw.pathname)||raw.search)continue;
        url=raw.toString();
      }catch{continue;}
    }
    const fps=Number(row.fps);
    const stream=(item.technical.streams as Array<{codec_type?:string;avg_frame_rate?:string}>|undefined)?.find(v=>v.codec_type==='video');
    const fraction=stream?.avg_frame_rate?.split('/').map(Number),mediaFps=fraction?.[0]&&fraction?.[1]?fraction[0]/fraction[1]:undefined;
    if(fps>0&&mediaFps&&Math.abs(fps-mediaFps)>.05)continue;
    tracks.push({language:lang,id:id||url,url,releaseName:release,...(fps>0?{fps}:{})});
  }
  return tracks;
}
async function text(url:string,headers:Record<string,string>,timeout=5000):Promise<string>{
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(timeout),redirect:'error'});
  if(!response.ok||!response.body)throw new Error('Optional subtitle service unavailable');
  let size=0;const chunks:Uint8Array[]=[];
  for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>2*1024*1024)throw new Error('Subtitle response too large');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}
export async function searchSubdl(item:MediaItem,c:Candidate,s:Subscription|undefined,key:string,guard:()=>void,budget:SubtitleBudget):Promise<SubdlMatch[]>{
  if(c.season===undefined||c.episode===undefined||c.language==='neutral'||['de','cs','en'].every(lang=>item.subtitles.some(t=>t.language===lang)))return [];
  if(!budget('search'))return [];
  const provenance=item.technical.acquisition as {originalFilename?:string}|undefined;
  const incoming=c.sourceUrl.startsWith('incoming:')?path.basename(c.sourceUrl.slice('incoming:'.length)):undefined;
  const stored=provenance?.originalFilename??incoming??path.basename(item.mediaPath);
  const filename=/\bS\d+E\d+\b|\b\d+x\d+\b/i.test(stored)?stored:`${item.showTitle}.S${String(c.season).padStart(2,'0')}E${String(c.episode).padStart(2,'0')} - ${c.title}.mp4`;
  const url=new URL('https://api.subdl.com/api/v2/files/search');
  url.search=new URLSearchParams({filename,engine:'local',episode_scope:'exact',type:'tv',languages:'de,cs,en',subs_per_page:'10'}).toString();
  guard();const result=JSON.parse(await text(url.toString(),{Authorization:`Bearer ${key}`,'User-Agent':'LKP v1.0'}));
  return matchSubdl(result,item,c,s);
}
export async function downloadSubdl(match:SubdlMatch,key:string):Promise<string>{
  const url=new URL(match.url),headers=url.hostname==='api.subdl.com'?{Authorization:`Bearer ${key}`,'User-Agent':'LKP v1.0'}:{};
  let result=await text(url.toString(),headers);
  if(result.trim().startsWith('{')){
    const data=JSON.parse(result),raw=data.url??data.link??data.download_url;
    const link=new URL(String(raw));
    if(link.protocol!=='https:'||link.hostname!=='dl.subdl.com'||link.pathname.endsWith('.zip'))throw new Error('No exact subtitle file available');
    result=await text(link.toString(),{});
  }
  return result;
}
export function subdlTrack(match:SubdlMatch,output:string):SubtitleTrack {
  return {language:match.language,kind:'downloaded',path:output,codec:'srt',provider:'subdl',providerId:match.id,releaseName:match.releaseName,...(match.fps?{sourceFps:match.fps}:{}),syncStatus:'unknown'};
}
