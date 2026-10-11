import type { AppConfig } from '../types.js';
import type { Classification, EditorialRank } from './classification.js';
export type Language = 'de' | 'en' | 'cs' | 'neutral';
export interface Subscription {
  id: string; title: string; aliases: string[]; description: string; language: Language;
  source: 'mediathek' | 'ct' | 'manual' | 'existing' | 'youtube'; queries: string[]; urls: string[];
  channelId?: string; defaultSeason?: number; editorialClassification?: boolean;
  minimumEditorialRank?: EditorialRank; forbidRecycledContent?: boolean;
  targetEpisodes: number; maxEpisodes: number; maxTotalDuration: number; maxBytes: number;
  priority: number; minDuration: number; maxDuration: number; preferredEras: number[];
  preferredSeasons: number[]; preferredFormats: string[]; include: string[]; exclude: string[];
  replacementPolicy: 'report' | 'none'; allowCompilations: boolean; allowShortClips: boolean;
}
export interface AcquisitionConfig {
  version: 1; reserveBytes: number; maxNewBytes: number; downloadBytesPerSecond: number;
  copyBytesPerSecond: number; jobsPerRun: number; stableSeconds: number;
  maxRunSeconds: number; connectTimeoutSeconds:number; downloadStallSeconds:number; discoveryLimit: number; scheduleGuardSeconds: number;
  idlePollSeconds: number;
  aiProvider?: 'chatgpt'; classificationModel?: string; publishToSchedule?: boolean;
  vpnFallback?:{enabled:boolean;helper:string;tokenFile:string};
  metadataModel: string; metadataRequestsPerRun: number; credentialsFile: string;
  subtitleRequestsPerDay: number; subtitleDownloadsPerDay: number;
  subtitleProviders: Array<{ name: 'opensubtitles'|'subdl'; keyEnv: string }>;
  editorialProviders: Array<{ name: 'theintrodb'; endpoint: string }>;
  subscriptions: Subscription[];
}
export interface Candidate {
  source: 'mediathek' | 'ct' | 'manual' | 'youtube'; sourceId: string; sourceUrl: string; showId: string;
  originalTitle?: string; invalidReason?: string; classification?: Classification;
  classificationVersion?: string; classificationModel?: string;
  title: string; language: Language; season?: number; episode?: number;
  description: string; descriptionLanguage: string; durationMs: number; size: number;
  broadcaster: string; publishedAt?: number; expiresAt?: number; downloadUrl?: string;
  subtitleUrl?: string; subtitleLanguage?: string; components: string[]; compilation: boolean; format: string; expiryText?: string;
  year?: number; available: boolean;
}
export interface Usage { episodes: number; durationMs: number; bytes: number }
import fs from 'node:fs';
import { validateYoutubeSubscription } from './adapters.js';
import { acquiredRank } from './classification.js';
import { recycledContent } from './recycled.js';
import path from 'node:path';
import { parse } from 'yaml';
export function normalize(value: string): string {
  return value.toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function titleIdentity(title: string): string {
  return normalize(title.replace(/\((?:S\d+)?E?\d+(?:\/\d+)?\)/gi, '').replace(/^\s*\d+\s*[.:/-]\s*/, '')
    .replace(/\s*\|.*$/, '').replace(/\b(?:folge|episode)\s*\d+\s*[:.-]?/gi, ''));
}
export function logicalKeys(c: Pick<Candidate, 'showId' | 'language' | 'season' | 'episode' | 'title'>): string[] {
  const prefix = `${c.showId}:${c.language}`;
  const title=titleIdentity(c.title);
  const result = title ? [`${prefix}:title:${title}`] : [];
  if (c.episode !== undefined && c.season !== undefined) result.push(`${prefix}:number:${c.season ?? 1}:${c.episode}`);
  return result;
}
export function urlIdentity(value: string): string {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|token|sig|expires)/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}
export function loadAcquisitionConfig(app: AppConfig, file = path.join(app.projectRoot, 'config/content-acquisition.yaml')) : AcquisitionConfig {
    const c = (parse(fs.readFileSync(file, 'utf8')) as AcquisitionConfig);
    if (c.version !== 1 || !Array.isArray(c.subscriptions) || !c.subscriptions.length)
        throw new Error('Invalid acquisition configuration');
    c.subtitleRequestsPerDay ??= 200;
    c.subtitleDownloadsPerDay ??= 40;
    c.idlePollSeconds ??= 1800;
    c.connectTimeoutSeconds ??= 20;
    c.downloadStallSeconds ??= 120;
    for (const key of (['reserveBytes','maxNewBytes','downloadBytesPerSecond','copyBytesPerSecond','jobsPerRun','stableSeconds','maxRunSeconds','connectTimeoutSeconds','downloadStallSeconds','idlePollSeconds','discoveryLimit','scheduleGuardSeconds','metadataRequestsPerRun','subtitleRequestsPerDay','subtitleDownloadsPerDay'] as const)) {
        if (!(key === 'maxNewBytes' && c[key] === null) && (!Number.isSafeInteger(c[key]) || c[key] < (key === 'metadataRequestsPerRun' ? 0 : 1)))
            throw new Error(`Invalid acquisition ${key}`);
    }
    if (c.maxNewBytes === null) c.maxNewBytes = Infinity;
    if (c.subtitleRequestsPerDay > 200 || c.subtitleDownloadsPerDay > 40)
        throw new Error('Subtitle lookup exceeds free-tier local limits');
    if (!Array.isArray(c.subtitleProviders) || c.subtitleProviders.some(p => !['subdl', 'opensubtitles'].includes(p.name) || !/^\w+_API_KEY$/.test(p.keyEnv)))
        throw new Error('Invalid subtitle provider configuration');
    const ids = new Set();
    for (const s of c.subscriptions) {
        if (!/^[a-z0-9-]+$/.test(s.id) || ids.has(s.id))
            throw new Error('Invalid/duplicate subscription ID');
        ids.add(s.id);
        if (!['de', 'en', 'cs', 'neutral'].includes(s.language) || !['existing', 'mediathek', 'ct', 'manual', 'youtube'].includes(s.source))
            throw new Error(`Invalid subscription ${s.id}`);
        for (const key of (['targetEpisodes','maxEpisodes','maxTotalDuration','maxBytes','priority','minDuration','maxDuration'] as const))
            if (!(key === 'maxBytes' && s[key] === null) && (!Number.isFinite(s[key]) || s[key] <= 0))
                throw new Error(`Invalid ${s.id}.${key}`);
        if (s.minimumEditorialRank !== undefined && (!s.editorialClassification || !['A+', 'A', 'B'].includes(s.minimumEditorialRank)))
            throw new Error('Invalid minimum editorial rank');
        if (s.forbidRecycledContent !== undefined && typeof s.forbidRecycledContent !== 'boolean') throw new Error('Invalid recycled-content policy');
        if (s.maxBytes === null) s.maxBytes = Infinity;
        if (s.targetEpisodes > s.maxEpisodes || s.minDuration > s.maxDuration)
            throw new Error(`Inconsistent limits for ${s.id}`);
        if (!['report', 'none'].includes(s.replacementPolicy) || typeof s.allowCompilations !== 'boolean' || typeof s.allowShortClips !== 'boolean')
            throw new Error(`Invalid ${s.id} policy`);
        for (const field of (['aliases','queries','urls','preferredEras','preferredSeasons','preferredFormats','include','exclude'] as const))
            if (!Array.isArray(s[field]))
                throw new Error(`Missing ${s.id}.${field}`);
        for (const rule of [...s.include, ...s.exclude])
            new RegExp(rule, 'iu');
        if (s.source === 'youtube') validateYoutubeSubscription(s);
        for (const url of s.urls)
            if (s.source !== 'youtube' && new URL(url).hostname !== 'www.ceskatelevize.cz')
                throw new Error('ČT subscription URLs must be official');
    }
    c.credentialsFile = path.resolve(app.projectRoot, c.credentialsFile);
    if (c.vpnFallback) {
        if (typeof c.vpnFallback.enabled !== 'boolean' || typeof c.vpnFallback.helper !== 'string' || typeof c.vpnFallback.tokenFile !== 'string')
            throw new Error('Invalid VPN fallback configuration');
        c.vpnFallback.helper = path.resolve(app.projectRoot, c.vpnFallback.helper);
        c.vpnFallback.tokenFile = path.resolve(app.projectRoot, c.vpnFallback.tokenFile);
    }
    return c;
}
export function unsupportedEdition(c:Pick<Candidate,'source'|'language'|'title'>):boolean {
  return c.source==='mediathek'&&c.language==='de'&&/\b(?:sorbisch|obersorbisch|niedersorbisch|sorbian)\b/i.test(c.title);
}
export function admission(c: Candidate, s: Subscription, u: Usage, newBytes: number, config: AcquisitionConfig) : string | undefined {
    if (s.forbidRecycledContent && recycledContent(c)) return 'Recycled content forbidden';
    if (s.editorialClassification && !acquiredRank(c.classification?.rank, s.minimumEditorialRank)) return c.classification ? 'Editorial rank excluded' : 'Awaiting editorial classification';
    if (unsupportedEdition(c))
        return 'Unsupported Sorbian language edition';
    if (!Number.isFinite(c.size) || c.size <= 0)
        return 'source size is unknown';
    if (!c.available)
        return 'source unavailable; manual acquisition required';
    if (c.language !== s.language)
        return 'language mismatch';
    if (!Number.isFinite(c.durationMs) || c.durationMs < s.minDuration * 1000 || c.durationMs > s.maxDuration * 1000)
        return 'duration/format outside curated range';
    if (!s.allowShortClips && /\b(clip|trailer|preview|vorschau|teaser|bonus|ausschnitt)\b/i.test(c.title))
        return 'clip/trailer excluded';
    if (c.compilation && !s.allowCompilations)
        return 'compilation excluded to avoid overlap';
    if (c.expiresAt && c.expiresAt <= Date.now())
        return 'source expired';
    const text = `${c.title}\n${c.description}`;
    if (s.exclude.some(rule => new RegExp(rule, 'iu').test(text)))
        return 'excluded by curation rule';
    if (s.include.length && !s.include.some(rule => new RegExp(rule, 'iu').test(text)))
        return 'not in curated selection';
    if (u.episodes >= Math.min(s.targetEpisodes, s.maxEpisodes))
        return 'collection target reached';
    if (u.durationMs + c.durationMs > s.maxTotalDuration * 1000)
        return 'show duration budget reached';
    if (u.bytes + c.size > s.maxBytes)
        return 'show byte budget reached';
    if (newBytes + c.size > config.maxNewBytes)
        return 'global acquisition budget reached';
    return undefined;
}
export function candidateScore(c: Candidate, s: Subscription): number {
  return (s.preferredSeasons.includes(c.season ?? -1) ? 20 : 0) +
    (s.preferredEras.some(year => (c.year ?? new Date(c.publishedAt ?? 0).getUTCFullYear()) >= year) ? 10 : 0) +
    (s.preferredFormats.includes(c.format) ? 5 : 0) + (c.subtitleUrl ? 2 : 0);
}
