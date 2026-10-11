import { normalizeCatalogueText, normalizeCatalogue, sourceEpisodeNumbers, catalogueMetadata } from '../catalogue.js';
import { catalogueChanges, writeCatalogue } from '../catalogue-maintenance.js';
import type { AppConfig, MediaItem } from '../types.js';
import type { LkpDatabase } from '../database.js';
import type { ProbeResult } from '../media.js';
import type { CandidateRow, FileRow } from './store.js';
import type { AcquisitionConfig, Candidate, Subscription, Usage } from './model.js';
import fs from 'node:fs';
import { AcquisitionCommandError, extractorArgs, discoverYoutube, recoverCtExtraction, recoverOrfExtraction, isOrf, usesStreamExtractor, discardOrfPlaylistFiles, applyEpisodeIdentity } from './adapters.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { classifyPending, rankPriority } from './classification.js';
import { recycledContent, purgeRecycled } from './recycled.js';
import { fetchText } from './sources.js';
import { youtubeEstimatedBytes, educationalYoutubeFormat } from './adapters.js';
import { parse, stringify } from 'yaml';
import { scanMedia, walk, parseEpisodeFilename } from '../media.js';
import { assertMediaStorage } from '../media-storage.js';
import { normalizeLanguage, stableId } from '../util.js';
import { rebuildFutureSchedule, ensureSchedule } from '../schedule.js';
import { writeEpgAtomic } from '../epg.js';
import { readPlayoutStatus } from '../playout-status.js';
import { AcquisitionStore } from './store.js';
import { admission, unsupportedEdition, candidateScore, logicalKeys, normalize } from './model.js';
import { austrianDiscovery, ceskaTelevize, mediathek } from './sources.js';
import { BroadcastGuard, Deferred, Quarantined, DownloadHttpError, download, execute, reserve, progressWatch, processAlive, sameSignature, signature } from './io.js';
import { enrichEditorial, enrichSubtitles, germanDescription, credential } from './enrichment.js';
export class ContentAcquisition {



    readonly store:AcquisitionStore;
    readonly root:string;
    private guard:BroadcastGuard;
    private paidRequests=0;
    private batchDeadline=Infinity;
    private subtitleBudget=(kind:'search'|'download'):boolean=>{
    const key=`subtitle-quota:${new Date().toISOString().slice(0,10)}:${kind}`;
    const count=Number(this.store.state(key)??0),limit=kind==='search'?this.config.subtitleRequestsPerDay:this.config.subtitleDownloadsPerDay;
    if(count>=limit)return false;this.store.set(key,String(count+1));return true;
  };
    constructor(readonly app:AppConfig,readonly db:LkpDatabase,readonly config:AcquisitionConfig) {
    this.store=new AcquisitionStore(db);this.root=path.join(app.media.root,'.acquisition');
    this.guard=new BroadcastGuard(app,db,config,Infinity);
  }
    private dirs():void {assertMediaStorage(this.app);for(const name of ['incoming','staging','quarantine'])fs.mkdirSync(path.join(this.root,name),{recursive:true});}
    private sub(id:string):Subscription|undefined {return this.config.subscriptions.find(s=>s.id===id);}
    private identify(show:string):Subscription|undefined {
    const matches=this.config.subscriptions.filter(s=>[s.id,s.title,...s.aliases].some(a=>normalize(a)===normalize(show)));
    return matches.length===1?matches[0]:undefined;
  }
    private async probe(file:string):Promise<ProbeResult> {
    this.guard.check(file);const stat=signature(file);
    const cached=this.db.db.prepare('SELECT * FROM acquisition_probe_cache WHERE path=?').get(file) as {size:number;mtime:number;probe_json:string}|undefined;
    if(cached&&sameSignature(cached,stat))return JSON.parse(cached.probe_json);
    const probe=JSON.parse(await execute(this.app.media.ffprobe,['-v','error','-show_format','-show_streams','-show_chapters','-of','json',file],()=>this.guard.check(file),30_000)) as ProbeResult;
    if(!sameSignature(stat,signature(file)))throw new Deferred('Asset changed during probe');
    this.db.db.prepare('INSERT INTO acquisition_probe_cache VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET size=excluded.size,mtime=excluded.mtime,probe_json=excluded.probe_json').run(file,stat.size,stat.mtime,JSON.stringify(probe));
    return probe;
  }

  private tracked(item:MediaItem,newAsset=0):FileRow {
    const s=this.sub(item.showId), language=s?.language??item.audioLanguage??item.defaultLanguage??'unknown';
    const identity={showId:item.showId,language:language as Candidate['language'],...sourceEpisodeNumbers(item)};
    const titles=[item.episodeTitle,catalogueMetadata(item)?.originalTitle??String((item.technical.acquisition as {originalTitle?:string}|undefined)?.originalTitle??item.episodeTitle)];
    return {path:item.mediaPath,...signature(item.mediaPath),show_id:item.showId,language,
      keys_json:JSON.stringify([...new Set(titles.flatMap(title=>logicalKeys({...identity,title})))]),
      catalogue_id:item.id,state:'indexed',new_asset:newAsset,acquired_at:Date.now()};
  }
    private quarantineUnsupportedEditions():void {
    const wrong=this.store.candidates(['imported']).filter(row=>unsupportedEdition(row.metadata));
    if(!wrong.length)return;
    const catalogue=new Map(this.db.listMedia(false).map(item=>[item.id,item]));
    for(const row of wrong){
      const item=row.catalogueId?catalogue.get(row.catalogueId):undefined;if(!item)continue;
      try{this.guard.check(item.mediaPath);}catch(error){if(error instanceof Deferred)continue;throw error;}
      const reason='Source explicitly labels a Sorbian edition; excluded from German library';
      const metadata=item.mediaPath.slice(0,-path.extname(item.mediaPath).length)+'.yaml';
      const previous=fs.existsSync(metadata)?parse(fs.readFileSync(metadata,'utf8')):{};
      const temporary=`${metadata}.language-review.tmp`;fs.writeFileSync(temporary,stringify({...previous,enabled:false}));fs.renameSync(temporary,metadata);
      this.db.upsertMedia([{...item,enabled:false,ingestState:'review',qcWarnings:[...(item.qcWarnings??[]),reason]}]);
      const file=this.store.files().find(f=>f.catalogue_id===item.id);if(file)this.store.file({...file,state:'quarantine'});
      this.store.transition(row.id,'quarantine',reason);
      this.store.manual(`language:${row.id}`,item.showId,reason,row.id);this.store.set('schedule-dirty','1');
    }
  }
    async index(limit=25):Promise<{files:number;pending:number}> {
    this.dirs();this.guard.check();
    const files=walk(this.app.media.root,new Set(this.app.media.supportedExtensions));
    const catalogue=new Map(this.db.listMedia(false).map(i=>[i.mediaPath,i]));
    const known=new Map(this.store.files().map(i=>[i.path,i]));let pending=0,probed=0;
    for(const file of files) {
      const stat=signature(file),old=known.get(file),item=catalogue.get(file);
      if(old&&sameSignature(stat,old)&&old.state!=='unprobed')continue;
      if(item && !old) {
        // Existing catalogue metadata is authoritative. Do not probe the complete HDD again.
        const tracked=this.tracked(item);this.store.file(tracked);known.set(file,tracked);continue;
      }
      if(old?.state==='quarantine'&&sameSignature(stat,old))continue;
      if(probed>=limit){pending++;this.store.file({path:file,...stat,show_id:old?.show_id??item?.showId??'unknown',language:old?.language??'unknown',keys_json:old?.keys_json??'[]',catalogue_id:item?.id??null,state:'unprobed',new_asset:old?.new_asset??0});continue;}
      try{
        this.guard.check(file);probed++;
        const [fresh]=await scanMedia(this.app,undefined,{files:[file],probe:f=>this.probe(f),skipLocalAnalysis:true});if(!fresh)continue;
        // Preserve persisted manual/editorial overrides while refreshing changed technical data.
        const merged=item?{...fresh,id:item.id,enabled:item.enabled,description:item.description,externalIds:item.externalIds??fresh.externalIds??{},
          editorialMarkers:[...(fresh.editorialMarkers??[]).filter(m=>m.source!=='manual'),...(item.editorialMarkers??[]).filter(m=>m.source==='manual')],creditsPolicy:item.creditsPolicy??fresh.creditsPolicy??'shorten',breakpoints:item.breakpoints??fresh.breakpoints??[]}:fresh;
        const s=this.sub(merged.showId);if(s?.language==='neutral'){merged.audioLanguage='zxx';merged.defaultLanguage='zxx';}
        const currentStat=signature(file);if(!sameSignature(stat,currentStat))throw new Deferred('Asset changed while indexing');
        this.db.upsertMedia([merged]);this.store.file(this.tracked(merged,old?.new_asset??0));
        if(!item)this.store.set('schedule-dirty','1');
      }catch(error){
        if(error instanceof Deferred){pending++;this.store.file({path:file,...stat,show_id:item?.showId??old?.show_id??'unknown',language:old?.language??'unknown',keys_json:old?.keys_json??'[]',catalogue_id:item?.id??null,state:'unprobed',new_asset:old?.new_asset??0});}
        else{if(item){this.db.upsertMedia([{...item,enabled:false,ingestState:'failed',qcWarnings:[...(item.qcWarnings??[]),'Changed media failed acquisition indexing']}]);this.store.set('schedule-dirty','1');}this.store.event(file,'existing-review','Existing file could not be indexed; retained in place');this.store.file({path:file,...stat,show_id:item?.showId??'unknown',language:'unknown',keys_json:'[]',catalogue_id:item?.id??null,state:'quarantine',new_asset:0});}
      }
    }
    // Correct neutral scheduling metadata without reading or changing the media asset.
    const neutral=this.db.listMedia(false).filter(i=>this.sub(i.showId)?.language==='neutral'&&i.audioLanguage!=='zxx');
    if(neutral.length)this.db.upsertMedia(neutral.map(i=>({...i,audioLanguage:'zxx',defaultLanguage:'zxx'})));
    // Missing files no longer count against acquisition budgets.
    for(const old of known.values())if(!files.includes(old.path))this.db.db.prepare("UPDATE acquisition_files SET state='missing' WHERE path=?").run(old.path);
    this.store.set('inventory-complete',pending===0?'1':'0');
    this.store.set('last-index',String(Date.now()));return {files:files.length,pending};
  }
    usage(showId:string):Usage {
    const files=this.store.files().filter(f=>f.show_id===showId&&['indexed','unprobed','quarantine'].includes(f.state));
    const ids=new Set(files.map(f=>f.catalogue_id).filter(Boolean));
    const media=this.db.listMedia(false).filter(i=>ids.has(i.id));
    return {episodes:files.length,durationMs:media.reduce((a,i)=>a+i.durationMs,0),bytes:files.reduce((a,i)=>a+i.size,0)};
  }
    private newBytes():number{return this.store.files().filter(f=>f.new_asset&&f.state!=='missing').reduce((a,f)=>a+f.size,0)+this.directoryBytes(path.join(this.root,'staging'))+this.directoryBytes(path.join(this.root,'quarantine'));}
    private duplicate(c:Candidate):string|undefined {
    const keys=logicalKeys(c);
    for(const file of this.store.files().filter(f=>f.state!=='missing'&&f.state!=='quarantine')) {
      if(JSON.parse(file.keys_json).some((k:string)=>keys.includes(k)))return file.catalogue_id??file.path;
    }
    const identical=this.store.candidates(['imported']).find(row=>row.metadata.sourceUrl===c.sourceUrl);
    if(identical)return identical.catalogueId??identical.id;
    return undefined;
  }
    async discover() : Promise<{discovered:number;errors:number}> {
        let discovered = 0, errors = 0;
        for (const s of [...this.config.subscriptions].sort((a, b) => b.priority - a.priority)) {
            this.guard.check();
            if (s.source === 'existing')
                continue;
            if (s.source === 'manual' && this.usage(s.id).episodes >= s.targetEpisodes)
                continue;
            if (s.source === 'manual') {
                this.store.manual(`show:${s.id}`, s.id, 'No suitable automatic source configured; use the incoming directory');
                continue;
            }
            try {
                const downloader = process.env.LKP_YT_DLP ?? path.join(this.app.projectRoot, 'runtime/tools/yt-dlp/bin/yt-dlp');
                const found = await (s.source === 'youtube'
                    ? discoverYoutube(s, this.config.discoveryLimit, downloader, execute, () => this.guard.check())
                    : s.source === 'mediathek' ? mediathek(s, this.config.discoveryLimit) : ceskaTelevize(s, this.config.discoveryLimit));
                for (const c of found) {
                    const id = this.store.remember(c);
                    discovered++;
                    if (!c.available && !s.editorialClassification && !this.duplicate(c))
                        this.store.manual(`candidate:${id}`, s.id, 'Discovered episode cannot be acquired automatically', id);
                }
                if (!found.length && this.usage(s.id).episodes < s.targetEpisodes)
                    this.store.manual(`show:${s.id}`, s.id, 'No currently discoverable approved episodes; monitoring remains active');
                this.store.set(`discovery:${s.id}`, JSON.stringify({ at: Date.now(), candidates: found.length }));
            }
            catch {
                errors++;
                this.store.set(`discovery:${s.id}`, JSON.stringify({ at: Date.now(), error: 'Source discovery unavailable; will retry' }));
            }
        }
        try {
            for (const item of await austrianDiscovery(60))
                if (!this.identify(item.topic))
                    this.store.manual(`austria:${stableId(item.sourceUrl, item.topic)}`, 'austrian-discovery', JSON.stringify(item));
        }
        catch {
            errors++;
        }
        this.store.set('last-discovery', String(Date.now()));
        for (const row of this.store.candidates(['bounded'])) {
            const s = this.sub(row.metadata.showId);
            if (s?.replacementPolicy === 'report' && candidateScore(row.metadata, s) >= 12)
                this.store.manual(`replacement:${row.id}`, s.id, 'Bounded collection: evaluate candidate as a replacement; no existing media will be deleted', row.id);
        }
        return { discovered, errors };
    }
    private budget(c:Candidate,s:Subscription):string|undefined {
    if(s.source==='existing')return 'Existing-only show; acquisition disabled';
    if(this.store.state('inventory-complete')!=='1')return 'Existing-library inventory is incomplete';
    const duplicate=this.duplicate(c);if(duplicate)return `duplicate:${duplicate}`;
    if(!logicalKeys(c).length)return 'Episode identity is ambiguous';
    for(const file of this.store.files().filter(f=>f.state==='indexed'))if(JSON.parse(file.keys_json).some((k:string)=>c.components.includes(k)))return 'Known component already stored individually';
    // Deterministic explicit component relationships, never speculative visual chopping.
    for(const row of this.store.candidates(['imported'])) {
      const left=logicalKeys(c),right=logicalKeys(row.metadata);
      if(c.components.some(k=>right.includes(k))||row.metadata.components.some(k=>left.includes(k)))return 'Known compilation/episode overlap';
    }
    return admission(c,s,this.usage(s.id),this.newBytes(),this.config);
  }
    private async downloadCandidate(c:Candidate,dir:string,s:Subscription):Promise<string> {
    this.store.set('active-download',JSON.stringify({id:stableId(c.source,c.sourceId),pid:process.pid}));
    try{return await this.downloadCandidateInner(c,dir,s);}finally{this.store.set('active-download','');}
  }
    async downloadCandidateInner(c:Candidate, dir:string, s:Subscription) : Promise<string> {
        // A previous run may have completed downloading before being interrupted.
        // Trust its completed filename; .part files never enter this path.
        if (isOrf(c)) discardOrfPlaylistFiles(dir);
        const completed = fs.readdirSync(dir).filter(n => /^(?:source|episode)\.(mp4|mkv|webm|mov)$/.test(n));
        if (completed.length === 1)
            return path.join(dir, completed[0]!);
        const ceiling = Math.min(s.maxBytes - this.usage(s.id).bytes, this.config.maxNewBytes - this.newBytes());
        if (usesStreamExtractor(c)) {
            const local = path.join(this.app.projectRoot, 'runtime/tools/yt-dlp/bin/yt-dlp');
            const downloader = process.env.LKP_YT_DLP ?? (fs.existsSync(local) ? local : 'yt-dlp');
            let metadata: Record<string,unknown>;
            let mediaUrl = c.sourceUrl;
            try {
                metadata = JSON.parse(await execute(downloader, [...extractorArgs(c.source, this.app.projectRoot), '--ignore-config', '--no-playlist', '--no-geo-bypass', '--no-warnings', ...(s.editorialClassification ? ['-f', educationalYoutubeFormat] : []), '--dump-single-json', c.sourceUrl], () => this.guard.check(), 40_000));
            }
            catch (error) {
                if (error instanceof Deferred) throw error;
                if (error instanceof AcquisitionCommandError && error.permanent) throw new Quarantined(error.message);
                throw new Deferred(error instanceof AcquisitionCommandError ? error.message : 'Downloader metadata extraction failed; retry scheduled');
            }
            // An expired ORF page may omit media that its discovered HLS URL still serves.
            if (isOrf(c) && !metadata.has_drm && !(metadata.formats as Array<Record<string,unknown>>|undefined)?.length && !(metadata.entries as Array<Record<string,unknown>>|undefined)?.length && c.downloadUrl) {
                mediaUrl = c.downloadUrl;
                try {
                    metadata = JSON.parse(await execute(downloader, ['--ignore-config', '--no-playlist', '--no-geo-bypass', '--no-warnings', '--dump-single-json', mediaUrl], () => this.guard.check(), 40_000));
                } catch (error) {
                    if (error instanceof Deferred) throw error;
                    if (error instanceof AcquisitionCommandError && error.permanent) throw new Quarantined(error.message);
                    throw new Deferred(error instanceof AcquisitionCommandError ? error.message : 'ORF playlist extraction failed; retry scheduled');
                }
                metadata.duration ??= c.durationMs / 1000;
            }
            const entries = (metadata.entries as Array<Record<string,unknown>>|undefined);
            if (entries?.length === 1)
                metadata = entries[0]!;
            else if (entries?.length)
                throw new Quarantined('Source page has ambiguous multiple media editions');
            const formats = (metadata.formats as Array<Record<string,unknown>>|undefined);
            if (!formats?.length || metadata.has_drm === true || formats.every(f => f.has_drm === true))
                throw new Quarantined('No supported non-DRM media format; manual acquisition required');
            if (c.source === 'youtube' && (metadata.channel_id !== s.channelId || (!s.editorialClassification && metadata.language && !/^en(?:-|$)/i.test(String(metadata.language)))))
                throw new Quarantined('Video does not match the approved English YouTube channel');
            applyEpisodeIdentity(c, s, metadata);
            this.store.remember(c);
            const subtitles = (metadata.subtitles as Record<string,Array<{url?:string}>>|undefined);
            const subtitleLanguage = c.language === 'neutral' ? 'cs' : c.language;
            const caption = subtitles?.[subtitleLanguage]?.find(t => t.url);
            if (caption?.url) {
                c.subtitleUrl = caption.url;
                c.subtitleLanguage = subtitleLanguage;
            }
            if (typeof metadata.description === 'string' && metadata.description.length > 10)
                c.description = metadata.description;
            const duration = Number(metadata.duration) * 1000;
            if (!Number.isFinite(duration) || duration <= 0)
                throw new Quarantined('Source duration is unknown');
            c.durationMs = duration;
            c.size = s.editorialClassification ? youtubeEstimatedBytes(metadata, duration) : Math.ceil(duration / 1000 * 1_500_000);
            const denied = this.budget(c, s);
            if (denied)
                throw new Deferred(denied);
            reserve(this.root, c.size * 2, this.config.reserveBytes);
            const progress = progressWatch(() => fs.readdirSync(dir).filter(n => /\.(?:part|mp4|mkv|webm|mov|ytdl|ts)$/.test(n)).reduce((sum, n) => sum + signature(path.join(dir, n)).size, 0), this.config.downloadStallSeconds);
            const watch = () => { progress(); this.guard.check(); reserve(this.root, Math.max(0, c.size), this.config.reserveBytes); const bytes = fs.readdirSync(dir).filter(n => fs.statSync(path.join(dir, n)).isFile()).reduce((a, n) => a + signature(path.join(dir, n)).size, 0); if (bytes > ceiling)
                throw new Quarantined('Downloader staging exceeds byte budget'); };
            try {
                await execute(downloader, [...extractorArgs(c.source, this.app.projectRoot), '--ignore-config', '--no-playlist', '--no-geo-bypass', '--no-warnings', '--no-progress', '--socket-timeout', String(this.config.connectTimeoutSeconds), '--continue', '--retries', '2', '--fragment-retries', '2', '--concurrent-fragments', '1', '--limit-rate', String(this.config.downloadBytesPerSecond), '-f', s.editorialClassification ? 'bv*[vcodec^=avc1][height<=1080]+ba/b[vcodec^=avc1][height<=1080]/b[height<=1080]' : 'bv*[vcodec^=avc1]+ba/b[vcodec^=avc1]/b', '--merge-output-format', 'mkv', '-o', path.join(dir, 'source.%(ext)s'), mediaUrl], watch, 0);
            }
            catch (error) {
                if (error instanceof Deferred)
                    throw error;
                if (error instanceof AcquisitionCommandError && error.permanent) throw new Quarantined(error.message);
                throw new Deferred(error instanceof AcquisitionCommandError ? error.message : 'Downloader transfer failed; retry scheduled');
            }
            const files = fs.readdirSync(dir).filter(n => /^source\.(mp4|mkv|webm|mov)$/.test(n));
            if (files.length !== 1)
                throw new Quarantined('Downloader did not produce one complete media file');
            return path.join(dir, files[0]!);
        }
        if (!c.downloadUrl)
            throw new Quarantined('No supported automatic download URL');
        // HEAD discovers actual HD size before the reservation and policy check.
        try {
            const head = await fetch(c.downloadUrl, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
            const actual = Number(head.headers.get('content-length'));
            if (head.ok && actual > 0)
                c.size = actual;
        }
        catch { }
        const reason = this.budget(c, s);
        if (reason)
            throw new Deferred(reason);
        reserve(this.root, c.size * 2, this.config.reserveBytes);
        const file = path.join(dir, 'source.mp4.part');
        const maxBytes = Math.min(ceiling, c.size * 1.1);
        try {
            await download(c.downloadUrl, file, maxBytes, this.config, () => this.guard.check());
        }
        catch (error) {
            if (!(error instanceof DownloadHttpError) || !this.canUseVpn(c, error.status))
                throw error;
            const job = path.join(dir, 'vpn-job.json');
            fs.writeFileSync(job, JSON.stringify({ url: c.downloadUrl, partial: file, maxBytes, worker: path.join(this.app.projectRoot, 'dist/src/acquisition/vpn-worker.js'), tokenFile: this.config.vpnFallback!.tokenFile, policy: { reserveBytes: this.config.reserveBytes, downloadBytesPerSecond: this.config.downloadBytesPerSecond, connectTimeoutSeconds: this.config.connectTimeoutSeconds, downloadStallSeconds: this.config.downloadStallSeconds } }), { mode: 0o600 });
            this.store.event(stableId(c.source, c.sourceId), 'vpn-fallback', 'German source returned HTTP 403; using isolated free German VPN');
            try {
                await execute('python3', [this.config.vpnFallback!.helper, job], () => { this.guard.check(); reserve(this.root, 1024 * 1024, this.config.reserveBytes); }, 0);
            }
            finally {
                fs.rmSync(job, { force: true });
            }
        }
        const complete = path.join(dir, 'source.mp4');
        fs.renameSync(file, complete);
        return complete;
    }
    canUseVpn(c:Candidate,status:number):boolean {
    const vpn=this.config.vpnFallback;
    if(status!==403||c.source!=='mediathek'||c.language!=='de'||/\bORF\b/i.test(c.broadcaster)||!vpn?.enabled)return false;
    try{return fs.statSync(vpn.helper).isFile()&&fs.statSync(vpn.tokenFile).isFile()&&(fs.statSync(vpn.tokenFile).mode&0o077)===0;}catch{return false;}
  }
    private async prepare(file:string,s:Subscription,dir:string):Promise<{file:string;probe:ProbeResult}> {
    // Probe headers for catalogue duration, tracks and codec preparation only.
    // Trust source metadata: no full decode, runtime comparison or file hash.
    let probe=await this.probe(file);
    const video=probe.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
    const needsAudio=!probe.streams.some(s=>s.codec_type==='audio');
    let prepared=file;
    if(video?.codec_name!=='h264'||needsAudio) {
      // Both playout outputs need audio; neutral silent sources receive silence.
      // Preserve compatible video bytes, dimensions and frame rate.
      const estimate=Math.max(signature(file).size*2,Number(probe.format.duration)*1_500_000);
      if(estimate>Math.min(s.maxBytes-this.usage(s.id).bytes,this.config.maxNewBytes-this.newBytes()))throw new Deferred('Insufficient budget for quality-preserving conversion');
      reserve(this.root,estimate,this.config.reserveBytes);prepared=path.join(dir,'prepared.mkv');
      const audioInput=needsAudio?['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']:[];
      const videoCodec=video?.codec_name==='h264'?['-c:v','copy']:['-c:v','libx264','-preset','slow','-crf','18','-threads','1'];
      const audioCodec=needsAudio?['-c:a','aac','-b:a','192k','-t',String(probe.format.duration)]:['-c:a','copy'];
      const progress=progressWatch(()=>fs.existsSync(prepared)?signature(prepared).size:0,this.config.downloadStallSeconds);
      await execute('ffmpeg',['-nostdin','-v','error','-y','-threads','1','-i',file,...audioInput,'-map','0:v:0','-map',needsAudio?'1:a:0':'0:a?','-map','0:s?','-map_metadata','0','-map_chapters','0',...videoCodec,...audioCodec,'-c:s','copy',prepared],()=>{progress();this.guard.check(file);reserve(this.root,1024*1024,this.config.reserveBytes);if(fs.existsSync(prepared)&&signature(prepared).size>estimate)throw new Deferred('Conversion exceeds reserved output budget');},0);
      probe=await this.probe(prepared);
    }
    return {file:prepared,probe};
  }
    async ingest(row:CandidateRow, source:string|undefined) : Promise<void> {
        const c = row.metadata, s = this.sub(c.showId);
        if (!s)
            throw new Quarantined('Unknown/unapproved programme');
        this.guard.check();
        const reason = this.budget(c, s);
        if (reason)
            throw new Deferred(reason);
        const dir = path.join(this.root, 'staging', row.id);
        fs.mkdirSync(dir, { recursive: true });
        const sourceSignature = source ? signature(source) : undefined;
        // Recover a prepared directory that reached rename before the database transaction.
        const finalDir = path.join(this.app.media.root, s.id, 'acquired', row.id);
        if (fs.existsSync(path.join(finalDir, 'ingest.json'))) {
            this.commit(finalDir, row.id);
            return;
        }
        const video = source ?? await this.downloadCandidate(c, dir, s);
        this.store.transition(row.id, 'processing');
        const prepared = await this.prepare(video, s, dir), ext = path.extname(prepared.file);
        const output = path.join(dir, `episode${ext}`);
        if (prepared.file !== output) {
            if (source && prepared.file === source) {
                reserve(this.root, signature(source).size, this.config.reserveBytes);
                // Copy in throttled chunks: the incoming file stays intact until commit succeeds.
                const handle = await fs.promises.open(output, 'w');
                let copied = 0, start = Date.now();
                try {
                    for await (const chunk of fs.createReadStream(source, { highWaterMark: 256 * 1024 })) {
                        this.guard.check(source);
                        reserve(this.root, chunk.length, this.config.reserveBytes);
                        await handle.write(chunk);
                        copied += chunk.length;
                        let wait = copied / this.config.copyBytesPerSecond * 1000 - (Date.now() - start);
                        while (wait > 0) {
                            await new Promise(r => setTimeout(r, Math.min(wait, 1000)));
                            this.guard.check(source);
                            wait = copied / this.config.copyBytesPerSecond * 1000 - (Date.now() - start);
                        }
                    }
                    await handle.sync();
                }
                finally {
                    await handle.close();
                }
            }
            else
                fs.renameSync(prepared.file, output);
        }
        if (source && sourceSignature && !sameSignature(sourceSignature, signature(source)))
            throw new Deferred('Incoming file changed during processing');
        const canonicalId = stableId('content', row.id), language = s.language === 'neutral' ? 'zxx' : s.language;
        const description = await germanDescription(c, s, this.config, this.paidRequests++ < this.config.metadataRequestsPerRun, { database: this.db.db, projectRoot: this.app.projectRoot });
        const listing = normalizeCatalogueText({ showTitle: s.title, episodeTitle: c.classification?.title ?? c.title, description: description.text }, s.aliases);
        const metadata = { id: canonicalId, title: listing.episodeTitle, description: listing.description, catalogue: { version: 1, originalTitle: c.originalTitle ?? c.title }, acquisition: { source: c.source, sourceId: c.sourceId, sourceUrl: c.sourceUrl, broadcaster: c.broadcaster, originalTitle: c.originalTitle ?? c.title, publishedAt: c.publishedAt, classification: c.classification, classificationVersion: c.classificationVersion, classificationModel: c.classificationModel }, ...(c.season !== undefined ? { season: c.season } : {}), ...(c.episode !== undefined ? { episode: c.episode } : {}) };
        const manualMeta = source ? this.readManualMetadata(source) : {};
        fs.writeFileSync(path.join(dir, 'show.yaml'), stringify({ id: s.id, title: s.title, description: s.description, language, weight: this.db.listMedia(false).find(i => i.showId === s.id)?.weight ?? 1, enabled: true }));
        fs.writeFileSync(path.join(dir, 'episode.yaml'), stringify({ ...manualMeta, ...metadata }));
        // Copy matching incoming sidecars before source-provided/provider subtitle handling.
        if (source) {
            const stem = source.slice(0, -path.extname(source).length);
            for (const lang of ['de', 'cs', 'en'])
                for (const format of ['srt', 'ass']) {
                    const sidecar = `${stem}.${lang}.${format}`;
                    if (fs.existsSync(sidecar) && signature(sidecar).size < 2 * 1024 * 1024)
                        fs.copyFileSync(sidecar, path.join(dir, `episode.${lang}.${format}`));
                }
        }
        const [scanned] = await scanMedia(this.app, undefined, { files: [output], probe: async () => prepared.probe, skipLocalAnalysis: true });
        if (!scanned)
            throw new Quarantined('Prepared media did not produce a catalogue item');
        const item = normalizeCatalogue([scanned], this.db.listMedia(false))[0]!;
        item.audioLanguage = language;
        item.defaultLanguage = language;
        item.subtitles = await enrichSubtitles(item, c, this.config, () => this.guard.check(), this.subtitleBudget);
        await enrichEditorial(item, this.config);
        this.refreshQc(item);
        const acceptedKeys = (JSON.parse(this.store.files().find(f=>f.path===source)?.keys_json??'[]') as string[]);
        if (acceptedKeys.length)
            throw new Quarantined('Incoming asset is already indexed as existing media');
        c.durationMs = item.durationMs;
        c.size = signature(output).size;
        const finalReason = this.budget(c, s);
        if (finalReason)
            throw new Deferred(finalReason);
        item.technical = { ...item.technical, acquisition: { source: c.source, sourceId: c.sourceId, broadcaster: c.broadcaster, sourceUrl: c.sourceUrl, publishedAt: c.publishedAt, expiresAt: c.expiresAt, originalTitle: c.originalTitle ?? c.title, classification: c.classification, classificationVersion: c.classificationVersion, classificationModel: c.classificationModel, description: description.provenance, ...(source ? { originalFilename: path.basename(source) } : {}) } };
        const mapPath = (p:string) => p.startsWith(`${dir}${path.sep}`) ? path.join(finalDir, path.relative(dir, p)) : p;
        item.mediaPath = mapPath(item.mediaPath);
        item.subtitles = item.subtitles.map(t => t.path ? { ...t, path: mapPath(t.path) } : t);
        // Persist enriched markers in the immutable sidecar so a later ordinary scan retains them.
        fs.writeFileSync(path.join(dir, 'episode.yaml'), stringify({ ...manualMeta, ...metadata, season: item.season, episode: item.episode, catalogue: item.technical.catalogue, externalIds: item.externalIds, markers: item.editorialMarkers, breakpoints: item.breakpoints, creditsPolicy: item.creditsPolicy }));
        // Keep only the canonical movie, subtitles, provenance and sidecars.
        for (const name of fs.readdirSync(dir))
            if (/^source\.|^prepared\./.test(name))
                fs.unlinkSync(path.join(dir, name));
        const videoFd = fs.openSync(output, 'r');
        try {
            fs.fsyncSync(videoFd);
        }
        finally {
            fs.closeSync(videoFd);
        }
        const manifestFile = path.join(dir, 'ingest.json');
        fs.writeFileSync(manifestFile, JSON.stringify({ item, candidate: c, mediaSignature: signature(output), incoming: source, incomingSignature: sourceSignature }), { mode: 0o640 });
        const manifestFd = fs.openSync(manifestFile, 'r');
        try {
            fs.fsyncSync(manifestFd);
        }
        finally {
            fs.closeSync(manifestFd);
        }
        this.guard.check();
        fs.mkdirSync(path.dirname(finalDir), { recursive: true });
        fs.renameSync(dir, finalDir);
        for (const directory of [finalDir, path.dirname(finalDir)]) {
            const fd = fs.openSync(directory, 'r');
            try {
                fs.fsyncSync(fd);
            }
            finally {
                fs.closeSync(fd);
            }
        }
        this.commit(finalDir, row.id);
    }
    commit(dir:string, id:string) : void {
        const manifest = (JSON.parse(fs.readFileSync(path.join(dir,'ingest.json'),'utf8')) as {item:MediaItem;candidate:Candidate;mediaSignature?:{size:number;mtime:number};incoming?:string;incomingSignature?:{size:number;mtime:number}});
        if (this.sub(manifest.candidate.showId)?.forbidRecycledContent && recycledContent(manifest.candidate))
            throw new Quarantined('Recycled content forbidden');
        if (path.dirname(manifest.item.mediaPath) !== dir || manifest.item.id !== stableId('content', id))
            throw new Quarantined('Invalid canonical recovery identity');
        if (!fs.existsSync(manifest.item.mediaPath))
            throw new Quarantined('Recovery manifest refers to missing media');
        if (manifest.mediaSignature && !sameSignature(manifest.mediaSignature, signature(manifest.item.mediaPath)))
            throw new Quarantined('Prepared asset changed before catalogue commit');
        this.db.db.transaction(() => {
            this.db.upsertMedia([manifest.item]);
            const tracked = this.tracked(manifest.item, 1);
            tracked.keys_json = JSON.stringify([...new Set([...JSON.parse(tracked.keys_json), ...logicalKeys(manifest.candidate)])]);
            this.store.file(tracked);
            this.store.remember(manifest.candidate);
            this.store.transition(id, 'imported', '', 0, manifest.item.id);
            this.store.set('schedule-dirty', '1');
            const keys = logicalKeys(manifest.candidate);
            for (const row of this.store.candidates(['manual']))
                if (logicalKeys(row.metadata).some(key => keys.includes(key))) {
                    this.store.transition(row.id, 'imported', 'Matched manual incoming asset', 0, manifest.item.id);
                    this.db.db.prepare("UPDATE acquisition_manual SET state='resolved',catalogue_id=? WHERE candidate_id=?").run(manifest.item.id, row.id);
                }
            this.db.db.prepare("UPDATE acquisition_manual SET state='resolved',catalogue_id=? WHERE id=?").run(manifest.item.id, `show:${manifest.item.showId}`);
        }).immediate();
        // No existing library media is deleted. Remove the incoming copy only after its identity is rechecked.
        if (manifest.incoming && manifest.incomingSignature && fs.existsSync(manifest.incoming) && sameSignature(manifest.incomingSignature, signature(manifest.incoming)))
            fs.unlinkSync(manifest.incoming);
    }
    private readManualMetadata(file:string):Record<string,unknown> {
    const metadata=file.slice(0,-path.extname(file).length)+'.yaml';if(!fs.existsSync(metadata))return {};
    if(signature(metadata).size>65536)throw new Quarantined('Manual metadata is too large');
    const value=parse(fs.readFileSync(metadata,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Quarantined('Invalid incoming metadata');return value;
  }
    private async manualCandidate(file:string):Promise<Candidate> {
    const meta=this.readManualMetadata(file),probe=await this.probe(file),stem=path.basename(file,path.extname(file));
    const naming=/^(.+?)__(de|cs|en|neutral)__(.+)$/i.exec(stem);
    const conventional=/^(.+?)\s+-\s+(S\d+E\d+.*?)(?:\s+\[(de|en|cs|neutral)\])?$/i.exec(stem);
    const show=String(meta.showId??meta.show??naming?.[1]??conventional?.[1]??(path.dirname(file)!==path.join(this.root,'incoming')?path.basename(path.dirname(file)):''));
    const s=this.identify(show);if(!s)throw new Quarantined('Unknown or ambiguous programme identity');
    const parsed=parseEpisodeFilename(`${naming?.[3]??conventional?.[2]??stem}${path.extname(file)}`);
    const audio=probe.streams.find(p=>p.codec_type==='audio');
    const declared=String(meta.language??naming?.[2]??conventional?.[3]??'');
    if(s.id==='timmy-time'&&declared!=='neutral')throw new Quarantined('Timmy Time edition must be explicitly identified as effectively language-neutral');
    const language=s.language==='neutral'?'neutral':String(declared||normalizeLanguage(audio?.tags?.language)||'');
    if(language!==s.language)throw new Quarantined('Missing or conflicting audio language; include __de__, __cs__, __en__ or __neutral__ in the filename');
    const season=meta.season??parsed.season,episode=meta.episode??parsed.episode;
    const c:Candidate={source:'manual',sourceId:stableId(file,signature(file).size,signature(file).mtime),sourceUrl:`incoming:${path.relative(this.root,file)}`,showId:s.id,
      title:String(meta.title??probe.format.tags?.title??parsed.title),language:s.language,
      ...(typeof season==='number'?{season}:{}),...(typeof episode==='number'?{episode}:{}),description:String(meta.sourceDescription??meta.description??''),descriptionLanguage:String(meta.descriptionLanguage??s.language),
      durationMs:Math.round(Number(probe.format.duration)*1000),size:signature(file).size,broadcaster:'manual',components:[],compilation:/compilation|XXL|best.of|sammlung/i.test(stem),format:'episode',available:true};
    if(!c.title.trim())throw new Quarantined('Episode identity is missing');
    const keys=logicalKeys(c),matches=this.store.candidates(['manual','discovered']).filter(r=>r.metadata.source!=='manual'&&logicalKeys(r.metadata).some(k=>keys.includes(k)));
    if(matches.length===1&&!c.description){c.description=matches[0]!.metadata.description;c.descriptionLanguage=matches[0]!.metadata.descriptionLanguage;}
    return c;
  }
    async incoming():Promise<number> {
    this.dirs();let imported=0;
    for(const file of walk(path.join(this.root,'incoming'),new Set(this.app.media.supportedExtensions))) {
      if(imported>=this.config.jobsPerRun||Date.now()>=this.batchDeadline)break;
      const stat=signature(file),key=`incoming:${file}`,prior=this.store.state(key);
      if(!prior){this.store.set(key,JSON.stringify({...stat,at:Date.now()}));continue;}
      const old=JSON.parse(prior) as {size:number;mtime:number;at:number};
      if(!sameSignature(old,stat)){this.store.set(key,JSON.stringify({...stat,at:Date.now()}));continue;}
      if(Date.now()-old.at<this.config.stableSeconds*1000||Date.now()-stat.mtime<this.config.stableSeconds*1000)continue;
      let id:string|undefined;
      try {
        const c=await this.manualCandidate(file);id=this.store.remember(c);
        const duplicate=this.duplicate(c);if(duplicate)throw new Quarantined(`Logical duplicate: ${duplicate}`);
        const row=this.store.candidates().find(r=>r.id===id)!;
        await this.ingest(row,file);imported++;
      }catch(error){
        if(error instanceof Deferred){if(id)this.store.transition(id,'deferred',error.message,Date.now()+30*60_000);continue;}
        const reason=error instanceof Quarantined?error.message:'Incoming file could not be probed or catalogued';
        const quarantine=path.join(this.root,'quarantine',id??stableId(file,stat.size));fs.mkdirSync(quarantine,{recursive:true});
        this.guard.check(file);fs.renameSync(file,path.join(quarantine,path.basename(file)));fs.writeFileSync(path.join(quarantine,'reason.json'),JSON.stringify({reason,originalPath:file,at:Date.now()}));
        if(id)this.store.transition(id,'quarantine',reason);this.store.event(file,'quarantine',reason);
      }
    }
    return imported;
  }
    async regenerate() : Promise<void> {
        if (this.config.publishToSchedule === false) return;
        if (this.store.state('schedule-dirty') !== '1')
            return;
        this.guard.check();
        const now = Date.now(), bounds = this.db.scheduleBounds();
        if (!bounds)
            ensureSchedule(this.db, this.app);
        else {
            // Preserve current/preloaded events, published weather and all continuity through a guarded future boundary.
            const status = readPlayoutStatus(path.join(this.app.storage.runtimeDirectory, 'playout-status.json'));
            const protectedIds = [status?.current?.scheduleEntryId, status?.next?.scheduleEntryId].filter(Boolean);
            const weather = (this.db.db.prepare("SELECT MAX(ends_at_ms) end FROM schedule_entries WHERE show_id='lkp-weather' AND ends_at_ms>?").get(now) as {end:number|null});
            let earliest = Math.max(now + this.config.scheduleGuardSeconds * 1000, weather.end ?? 0);
            for (const id of protectedIds) {
                const row = (this.db.db.prepare('SELECT ends_at_ms FROM schedule_entries WHERE id=?').get(id) as {ends_at_ms:number}|undefined);
                if (row)
                    earliest = Math.max(earliest, row.ends_at_ms);
            }
            const backup = `${this.app.storage.database}.before-acquisition.sqlite`;
            await this.db.db.backup(backup);
            // This rebuild calls the existing editorial/ad/intermission planner without owning playout.
            if (!this.db.nextAfter(earliest))
                throw new Deferred('No safe future schedule boundary; regeneration remains pending');
            rebuildFutureSchedule(this.db, this.app, earliest);
        }
        writeEpgAtomic(this.db.listSchedule(now - 86400000, now + this.app.schedule.epgDays * 86400000), this.app);
        this.store.set('schedule-dirty', '0');
        this.store.event('schedule', 'regenerated', 'Protected current/preloaded events and published weather');
    }
    private refreshQc(item:MediaItem):void {
    item.qcWarnings=(item.qcWarnings??[]).filter(warning=>{
      const language=/^Missing (de|cs|en) subtitles$/.exec(warning)?.[1];
      if(language&&item.subtitles.some(t=>t.language===language))return false;
      if(warning.startsWith('No reliable credits marker')&&item.editorialMarkers?.some(m=>m.kind==='credits'&&m.confidence>=.7))return false;
      if(warning.startsWith('No IMDb/TMDb/TVDB identifier')&&Object.keys(item.externalIds??{}).length)return false;
      return true;
    });
    item.ingestState=item.qcWarnings.length?'review':'ready';
  }
    private async recover():Promise<void> {
    for(const file of walk(this.app.media.root,new Set(this.app.media.supportedExtensions))) {
      const dir=path.dirname(file),manifest=path.join(dir,'ingest.json');
      if(!fs.existsSync(manifest))continue;
      const id=path.basename(dir),row=this.store.candidates().find(r=>r.id===id);
      if(row&&row.state!=='imported'&&row.state!=='quarantine'){
        try{this.guard.check(file);this.commit(dir,id);}
        catch(error){
          if(error instanceof Deferred){this.store.transition(id,'deferred','Recovery waits for a protected asset',Date.now()+30*60_000);continue;}
          const reason=error instanceof Quarantined?error.message:'Recovery manifest is invalid';
          this.store.transition(id,'quarantine',reason);
          const existing=this.db.listMedia(false).find(i=>i.mediaPath===file);
          if(existing){this.db.upsertMedia([{...existing,enabled:false,ingestState:'failed',qcWarnings:[...(existing.qcWarnings??[]),reason]}]);this.store.set('schedule-dirty','1');}
          else{const target=path.join(this.root,'quarantine',`${id}-recovery`);fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target)){fs.renameSync(dir,target);fs.writeFileSync(path.join(target,'reason.json'),JSON.stringify({reason,at:Date.now()}));}}
        }
      }
    }
  }
    async enrichExisting() : Promise<number> {
        let enriched = 0;
        const subtitleEnabled = this.config.subtitleProviders.some(provider => Boolean(credential(this.config, provider.keyEnv)));
        for (const item of this.db.listMedia(false)) {
            if (enriched >= this.config.jobsPerRun || Date.now() >= this.batchDeadline)
                break;
            const s = this.sub(item.showId);
            if (!s)
                continue;
            const provenance = (item.technical.acquisition as {description?:{retry?:boolean}}|undefined)?.description;
            const retryKey = `enrichment:${item.id}`;
            if (Number(this.store.state(retryKey) ?? 0) > Date.now())
                continue;
            const missing = subtitleEnabled && s.language !== 'neutral' && ['de', 'cs', 'en'].some(l => !item.subtitles.some(t => t.language === l));
            if (!provenance?.retry && !missing && item.description.length > 20 && item.showDescription.length > 20)
                continue;
            try {
                this.guard.check(item.mediaPath);
                const previousDescription = item.description, previousShowDescription = item.showDescription, previousTracks = JSON.stringify(item.subtitles);
                const row = this.store.candidates(['imported']).find(r => r.catalogueId === item.id);
                const c: Candidate = row?.metadata ?? { source: 'manual', sourceId: item.id, sourceUrl: `catalogue:${item.id}`, showId: item.showId, title: item.episodeTitle, language: s.language, description: item.description, descriptionLanguage: 'de', durationMs: item.durationMs, size: signature(item.mediaPath).size, broadcaster: 'catalogue', components: [], compilation: false, format: 'episode', available: true };
                if (provenance?.retry || item.description.length <= 20) {
                    const german = await germanDescription(c, s, this.config, this.paidRequests++ < this.config.metadataRequestsPerRun, { database: this.db.db, projectRoot: this.app.projectRoot });
                    item.description = german.text;
                    item.technical = { ...item.technical, acquisition: { ...((item.technical.acquisition as object) ?? {}), description: german.provenance } };
                }
                if (!item.showDescription)
                    item.showDescription = s.description;
                item.subtitles = await enrichSubtitles(item, c, this.config, () => this.guard.check(item.mediaPath), this.subtitleBudget);
                if (item.description !== previousDescription || item.showDescription !== previousShowDescription || JSON.stringify(item.subtitles) !== previousTracks) {
                    if (item.description !== previousDescription) {
                        const metadata = item.mediaPath.slice(0, -path.extname(item.mediaPath).length) + '.yaml';
                        const previous = fs.existsSync(metadata) ? parse(fs.readFileSync(metadata, 'utf8')) : {};
                        const temporary = `${metadata}.tmp`;
                        fs.writeFileSync(temporary, stringify({ ...previous, description: item.description }));
                        fs.renameSync(temporary, metadata);
                    }
                    this.refreshQc(item);
                    this.db.upsertMedia([item]);
                    this.store.set('schedule-dirty', '1');
                }
                enriched++;
            }
            catch (error) {
                if (!(error instanceof Deferred))
                    this.store.event(item.id, 'enrichment-retry', 'Optional enrichment unavailable');
            }
            this.store.set(retryKey, String(Date.now() + 7 * 86400000));
        }
        return enriched;
    }
    nextAutomaticRunAt(result:Record<string,unknown>,now=Date.now()):number {
    const idle=now+this.config.idlePollSeconds*1000;
    // Runtime protection failures pause globally; source failures retain their
    // individual backoff and must not hold up other eligible candidates.
    if(result.deferred&&result.deferred!=='Run time budget reached')return idle;
    let next=Math.max(now,Number(this.store.state('last-discovery')??0)+this.config.idlePollSeconds*1000);
    for(const row of this.store.candidates(['discovered','deferred','processing'])) {
      const s=this.sub(row.metadata.showId);
      if(!s||s.source==='manual'||s.source==='existing'||this.budget(row.metadata,s))continue;
      if(row.retryAt<=now)return now;
      next=Math.min(next,row.retryAt);
    }
    return Math.min(idle,next);
  }
    async run(options:{indexOnly?:boolean;discoverOnly?:boolean;indexLimit?:number;scheduled?:boolean}={}) : Promise<Record<string,unknown>> {
        if (options.scheduled && Number(this.store.state('next-automatic-run') ?? 0) > Date.now())
            return { idleUntil: Number(this.store.state('next-automatic-run')) };
        this.dirs();
        const owner = `${process.pid}:${randomUUID()}`;
        if (!this.store.acquire(owner, (this.config.maxRunSeconds + 300) * 1000))
            return { deferred: 'Another content-acquisition worker owns the lease' };
        let leaseError: Error|undefined;
        const renew = setInterval(() => { try {
            this.store.renew(owner, (this.config.maxRunSeconds + 300) * 1000);
        }
        catch (e) {
            leaseError = e instanceof Error ? e : new Error(String(e));
            this.guard = new BroadcastGuard(this.app, this.db, this.config, 0);
        } }, 20_000);
        const checkLease = () => { if (leaseError)
            throw leaseError; };
        const result: Record<string,unknown> = {};
        try {
            // Finish catalogue migration after any worker from the previous immutable
            // release has completed its batch. This runs under the normal lease.
            if (!this.store.state('catalogue-v1-normalized')) {
                if (catalogueChanges(this.db).changes.length) {
                    const backup = `${this.app.storage.database}.before-catalogue-worker-${Date.now()}.sqlite`;
                    await this.db.db.backup(backup);
                    fs.chmodSync(backup, 0o600);
                    writeCatalogue(this.db, backup);
                    writeEpgAtomic(this.db.listSchedule(Date.now() - 86_400_000, Date.now() + this.app.schedule.epgDays * 86_400_000), this.app);
                }
                this.store.set('catalogue-v1-normalized', '1');
            }
            this.batchDeadline = Date.now() + this.config.maxRunSeconds * 1000;
            this.store.set('last-run-start', String(Date.now()));
            // Reopen collections whose targets were raised; run once under the worker lease.
            if (!this.store.state('collection-limit-normalization-20261010')) {
                const raised = new Set(["sendung-mit-dem-elefanten","bobo-siebenschlaefer","kikaninchen","unser-sandmaennchen","peppa-wutz","sesamstrasse","bing","servus-kasperl","abc-baer","tolle-tiere","sarah-and-duck","puffin-rock","kipper","bob-a-bobek","maxipes-fik","rakosnicek","pat-a-mat","pingu","timmy-time"]);
                for (const row of this.store.candidates(['bounded'])) {
                    if (raised.has(row.metadata.showId) && ['collection target reached', 'show duration budget reached'].includes(row.reason))
                        this.store.transition(row.id, 'discovered', 'Collection limit increased; reassess candidate');
                }
                this.store.set('last-discovery', '0');
                this.store.set('collection-limit-normalization-20261010', '1');
            }
            recoverCtExtraction(this.store);
            recoverOrfExtraction(this.store);
            // First batch after adding the channels discovers them even when an
            // old immutable worker recently refreshed its other subscriptions.
            if (!this.store.state('educational-subscriptions-v1')) {
                this.store.set('last-discovery', '0');
                this.store.set('educational-subscriptions-v1', '1');
            }
            // Retry old German source failures once when the new authenticated fallback
            // becomes available. Existing manual records resolve through normal import.
            const recoveryKey = 'vpn-fallback-recovery-v1';
            if (!this.store.state(recoveryKey)) {
                const recoverable = this.store.candidates(['manual']).filter(row => row.reason === 'Repeated processing failures; manual preparation required' && this.canUseVpn(row.metadata, 403));
                if (recoverable.length) {
                    for (const row of recoverable) {
                        this.db.db.prepare('UPDATE acquisition_candidates SET attempts=0 WHERE id=?').run(row.id);
                        this.store.transition(row.id, 'discovered', 'Retry with newly configured isolated VPN fallback');
                    }
                    this.store.set(recoveryKey, '1');
                }
            }
            if (!options.discoverOnly) {
                await purgeRecycled(this);
                await this.recover();
                this.quarantineUnsupportedEditions();
                result.index = await this.index(options.indexLimit ?? 25);
                checkLease();
            }
            if (options.indexOnly) {
                await this.regenerate();
                return result;
            }
            if (!options.scheduled || Date.now() - Number(this.store.state('last-discovery') ?? 0) >= this.config.idlePollSeconds * 1000)
                result.discovery = await this.discover();
            else
                result.discovery = { cached: true };
            checkLease();
            result.classified = await classifyPending(this, { execute, request: fetchText, credential, extractorArgs });
            checkLease();
            if (options.discoverOnly)
                return result;
            result.incoming = await this.incoming();
            checkLease();
            result.enriched = await this.enrichExisting();
            let imported = 0;
            const rows = this.store.candidates(['discovered', 'deferred', 'processing', 'bounded']).filter(r => r.retryAt <= Date.now());
            rows.sort((a, b) => { const sa = this.sub(a.metadata.showId), sb = this.sub(b.metadata.showId); return rankPriority(b.metadata.classification?.rank) - rankPriority(a.metadata.classification?.rank) || (sb?.priority ?? 0) - (sa?.priority ?? 0) + (sb ? candidateScore(b.metadata, sb) / 100 : 0) - (sa ? candidateScore(a.metadata, sa) / 100 : 0) || a.id.localeCompare(b.id); });
            let attempts = 0;
            for (const row of rows) {
                if (Date.now() >= this.batchDeadline) {
                    result.batchLimitReached = true;
                    break;
                }
                this.guard.check();
                checkLease();
                if (attempts >= Math.max(0, this.config.jobsPerRun - Number(result.incoming ?? 0)))
                    break;
                const s = this.sub(row.metadata.showId);
                if (!s)
                    continue;
                if (s.editorialClassification && !row.metadata.classification) continue;
                const reason = this.budget(row.metadata, s);
                if (reason) {
                    if (reason.startsWith('duplicate:')) {
                        const catalogueId = reason.slice('duplicate:'.length);
                        this.store.transition(row.id, 'duplicate', reason, 0, catalogueId);
                        this.db.db.prepare("UPDATE acquisition_manual SET state='resolved',catalogue_id=? WHERE candidate_id=?").run(catalogueId, row.id);
                    }
                    else if (reason.includes('unavailable')) {
                        this.store.transition(row.id, 'manual', reason);
                        this.store.manual(`candidate:${row.id}`, s.id, reason, row.id);
                    }
                    else if (reason.includes('target reached') || reason.includes('budget reached'))
                        this.store.transition(row.id, 'bounded', reason);
                    else if (reason.includes('inventory'))
                        this.store.transition(row.id, 'deferred', reason, Date.now() + 30 * 60_000);
                    else
                        this.store.transition(row.id, 'rejected', reason);
                    continue;
                }
                if (row.attempts >= 5 && !usesStreamExtractor(row.metadata)) {
                    this.store.transition(row.id, 'manual', 'Repeated processing failures; manual preparation required');
                    this.store.manual(`candidate:${row.id}`, s.id, 'Repeated processing failures; manual preparation required', row.id);
                    continue;
                }
                attempts++;
                this.db.db.prepare('UPDATE acquisition_candidates SET attempts=attempts+1 WHERE id=?').run(row.id);
                try {
                    await this.ingest(row, undefined);
                    imported++;
                }
                catch (error) {
                    if (error instanceof Quarantined) {
                        const state = error.message.startsWith('Duplicate') ? 'duplicate' : usesStreamExtractor(row.metadata) ? 'manual' : 'quarantine';
                        this.store.transition(row.id, state, error.message);
                        if (state === 'manual')
                            this.store.manual(`candidate:${row.id}`, s.id, error.message, row.id);
                    }
                    else {
                        const reason = error instanceof Deferred ? error.message : 'Acquisition processing failed; retry scheduled';
                        this.store.transition(row.id, 'deferred', reason, Date.now() + Math.min(24 * 60, 30 * 2 ** Math.min(row.attempts, 6)) * 60_000);
                    }
                }
            }
            result.imported = imported;
            await this.regenerate();
            this.store.set('last-run-end', String(Date.now()));
            return result;
        }
        catch (error) {
            if (error instanceof Deferred) {
                result.deferred = error.message;
                this.store.event('worker', 'deferred', error.message);
                return result;
            }
            throw error;
        }
        finally {
            clearInterval(renew);
            try {
                if (options.scheduled) {
                    // Set a conservative fallback first, including unexpected failures.
                    this.store.set('next-automatic-run', String(Date.now() + this.config.idlePollSeconds * 1000));
                    if (result.imported !== undefined || result.deferred)
                        this.store.set('next-automatic-run', String(this.nextAutomaticRunAt(result)));
                }
            }
            finally {
                this.store.release(owner);
            }
        }
    }
    report(command:string):unknown {
    if(command==='subscriptions')return this.config.subscriptions.map(s=>({...s,usage:this.usage(s.id),discovery:this.store.state(`discovery:${s.id}`)}));
    if(command==='pending-manual')return this.db.db.prepare("SELECT * FROM acquisition_manual WHERE state='pending' ORDER BY show_id,first_seen").all();
    if(command==='history')return this.db.db.prepare(`SELECT h.*,json_extract(c.metadata_json,'$.title') AS title,json_extract(c.metadata_json,'$.showId') AS show FROM acquisition_history h LEFT JOIN acquisition_candidates c ON c.id=h.item ORDER BY h.id DESC LIMIT 100`).all();
    if(command==='quarantine')return {candidates:this.store.candidates(['quarantine','manual']),existing:this.store.files().filter(f=>f.state==='quarantine'),directory:path.join(this.root,'quarantine'),files:this.quarantineReports()};
    if(command==='storage')return {reserveBytes:this.config.reserveBytes,maxNewBytes:this.config.maxNewBytes,newBytes:this.newBytes(),shows:[...new Set([...this.config.subscriptions.map(s=>s.id),...this.store.files().map(f=>f.show_id)])].map(show=>({show,title:this.sub(show)?.title??show,...this.usage(show)})),staging:this.directoryBytes(path.join(this.root,'staging')),quarantine:this.directoryBytes(path.join(this.root,'quarantine'))};
    const currentDownloads=this.currentDownloads(),lease=this.db.db.prepare('SELECT owner,expires FROM acquisition_lock').get();
    return {activity:currentDownloads.length?'downloading':lease?'processing-or-discovering':'waiting',currentDownloads,lease,nextAutomaticRunAt:this.store.state('next-automatic-run'),spokenLanguageTargets:this.app.schedule.spokenLanguageTargets,inventoryComplete:this.store.state('inventory-complete')==='1',lastRunStart:this.store.state('last-run-start'),lastRunEnd:this.store.state('last-run-end'),scheduleDirty:this.store.state('schedule-dirty')==='1',files:this.store.files().length,
      candidateStates:this.db.db.prepare('SELECT state,count(*) count FROM acquisition_candidates GROUP BY state').all(),incoming:path.join(this.root,'incoming'),manualPending:(this.db.db.prepare("SELECT count(*) count FROM acquisition_manual WHERE state='pending'").get() as {count:number}).count,
      vpnFallback:{enabled:Boolean(this.config.vpnFallback?.enabled),configured:Boolean(this.config.vpnFallback&&fs.existsSync(this.config.vpnFallback!.helper)&&fs.existsSync(this.config.vpnFallback!.tokenFile))},subtitleProviders:this.config.subtitleProviders.map(provider=>({name:provider.name,configured:Boolean(credential(this.config,provider.keyEnv))})),subtitleLimits:{searchesPerDay:this.config.subtitleRequestsPerDay,downloadsPerDay:this.config.subtitleDownloadsPerDay}};
  }
    private currentDownloads():unknown[] {
    const now=Date.now(),lease=this.db.db.prepare('SELECT owner,expires FROM acquisition_lock').get() as {owner:string;expires:number}|undefined;
    const pid=Number(lease?.owner.split(':')[0]);
    if(!lease||lease.expires<=now||!Number.isSafeInteger(pid)||pid<=0||!processAlive(pid,now))return [];
    let active:{id:string;pid:number};try{active=JSON.parse(this.store.state('active-download')??'');}catch{return [];}
    if(active.pid!==pid)return [];
    const staging=path.join(this.root,'staging');if(!fs.existsSync(staging))return [];
    const candidate=this.db.db.prepare("SELECT metadata_json FROM acquisition_candidates WHERE id=? AND state NOT IN ('imported','duplicate','quarantine','manual','rejected','bounded')");
    return fs.readdirSync(staging,{withFileTypes:true}).flatMap(entry=>{
      if(!entry.isDirectory()||entry.name!==active.id)return [];
      const row=candidate.get(entry.name) as {metadata_json:string}|undefined;if(!row)return [];
      const c=JSON.parse(row.metadata_json) as Candidate,dir=path.join(staging,entry.name);
      let bytes=0,mtime=0;
      // Header/file stats only. Never probe or read media to report progress.
      try{for(const file of fs.readdirSync(dir)){if(file.endsWith('.resume.json')||!/^source\..*\.part(?:$|[-.])/.test(file))continue;const stat=signature(path.join(dir,file));bytes+=stat.size;mtime=Math.max(mtime,stat.mtime);}}catch{return [];}
      if(bytes<=0||now-mtime>this.config.downloadStallSeconds*1000)return [];
      return [{show:c.showId,programme:this.sub(c.showId)?.title??c.showId,title:c.title,downloadedBytes:bytes,estimatedTotalBytes:c.size,estimatedPercent:c.size>0?Math.min(100,Math.round(bytes/c.size*100)):null,lastProgressSecondsAgo:Math.max(0,Math.round((now-mtime)/1000))}];
    });
  }
    private quarantineReports():unknown[] {
    const dir=path.join(this.root,'quarantine');if(!fs.existsSync(dir))return [];
    return fs.readdirSync(dir).flatMap(name=>{const reason=path.join(dir,name,'reason.json');try{return [{directory:path.join(dir,name),...JSON.parse(fs.readFileSync(reason,'utf8'))}];}catch{return [];}});
  }
    private directoryBytes(dir:string):number {
    if(!fs.existsSync(dir))return 0;let bytes=0;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())bytes+=this.directoryBytes(file);else if(entry.isFile())bytes+=signature(file).size;}return bytes;
  }
}
