import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { DateTime } from 'luxon';
import type { AppConfig, MediaBroadcastPolicy, MediaItem, ProfileId, StationConfig, ScheduleEntry } from './types.js';

export function validateMediaPolicy(value: unknown): MediaBroadcastPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid broadcast policy');
  const p = value as MediaBroadcastPolicy;
  if (!Array.isArray(p.profiles) || p.profiles.some(id => !['lkp', 'ln'].includes(id)) ||
    ![0, 6, 12, 16, 18, null].includes(p.recommendedAge) || !['editorial', 'manual', 'unknown'].includes(p.ratingSource) ||
    typeof p.category !== 'string' || !Array.isArray(p.topics) || p.topics.some(t => typeof t !== 'string') ||
    !['calm', 'moderate', 'high'].includes(p.intensity) || !['any', 'evening', 'late', 'quiet'].includes(p.timeOfNight) ||
    !['latest-only', 'protected', 'standard', 'temporary'].includes(p.retention) || !Number.isFinite(p.priority) ||
    (p.expiresAtMs !== undefined && !Number.isFinite(p.expiresAtMs)) ||
    (p.confidence !== undefined && (!Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1))) throw new Error('Invalid broadcast policy');
  if (p.profiles.includes('lkp') && (p.recommendedAge ?? 0) >= 12) throw new Error('Age 12+ content cannot enter the children’s profile');
  return p;
}

export function loadStationConfig(projectRoot: string, filename = 'config/channels.yaml'): StationConfig | undefined {
  const file = path.resolve(projectRoot, filename);
  if (!fs.existsSync(file)) return undefined;
  const c = parse(fs.readFileSync(file, 'utf8')) as StationConfig;
  if (c.activateAtMs !== undefined && !Number.isSafeInteger(c.activateAtMs)) throw new Error('Invalid channel activation time');
  const validTime = (s: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s);
  if (typeof c.enabled !== 'boolean' || c.timezone !== 'Europe/Prague' || !c.hours ||
    !Object.values(c.hours).every(validTime) || !(c.hours.morningEnd < c.hours.weekdayStart && c.hours.morningEnd < c.hours.weekendStart) ||
    !['sequential', 'shuffle'].includes(c.rotation) || !Number.isFinite(c.newsOffsetMinutes) || c.newsOffsetMinutes < 5 || c.newsOffsetMinutes > 15 ||
    !c.storage || !Object.values(c.storage).every(v => Number.isSafeInteger(v) && v > 0) ||
    c.classifier?.provider !== 'configured' || typeof c.classifier.model !== 'string' ||
    !Number.isSafeInteger(c.classifier.maxRequestsPerRun) || c.classifier.maxRequestsPerRun < 0 ||
    !Number.isSafeInteger(c.classifier.maxRequestsPerDay) || c.classifier.maxRequestsPerDay < 0 ||
    !(c.classifier.confidence > 0 && c.classifier.confidence <= 1) || typeof c.assetManifest !== 'string') throw new Error('Invalid station configuration');
  c.assetManifest = path.resolve(projectRoot, c.assetManifest);
  for (const id of ['lkp', 'ln'] as const) {
    const p = c.profiles?.[id];
    if (p?.id !== id || !p.name || !p.abbreviation || typeof p.logo !== 'string' || !Number.isFinite(p.logoWidth) || p.logoWidth < 32 ||
      typeof p.advertising !== 'boolean' || typeof p.animateProgrammeLogo !== 'boolean' || !Array.isArray(p.languages) || !Array.isArray(p.categories)) throw new Error('Invalid channel profile');
    p.logo = path.resolve(projectRoot, p.logo);
  }
  for (const value of Object.values(c.showPolicies ?? {})) validateMediaPolicy(value);
  return c;
}

export interface ProfileWindow { profile: ProfileId; startsAtMs: number; endsAtMs: number; eveningDate: string }
const timeOn = (date: DateTime, clock: string) => date.startOf('day').set({ hour: Number(clock.slice(0, 2)), minute: Number(clock.slice(3)) });
/** Civil dates, never +24h: both DST nights end at precisely 06:00 local. */
export function profileWindow(atMs: number, station: StationConfig): ProfileWindow {
  const now = DateTime.fromMillis(atMs, { zone: station.timezone });
  if (!now.isValid) throw new Error('Invalid station clock');
  const morning = timeOn(now, station.hours.morningEnd);
  const startToday = timeOn(now, now.weekday >= 6 ? station.hours.weekendStart : station.hours.weekdayStart);
  const night = now < morning || now >= startToday;
  const evening = now < morning ? now.minus({ days: 1 }) : now;
  const nightStart = timeOn(evening, evening.weekday >= 6 ? station.hours.weekendStart : station.hours.weekdayStart);
  return night ? { profile: 'ln', startsAtMs: nightStart.toMillis(), endsAtMs: timeOn(evening.plus({ days: 1 }), station.hours.morningEnd).toMillis(), eveningDate: evening.toISODate()! }
    : { profile: 'lkp', startsAtMs: morning.toMillis(), endsAtMs: startToday.toMillis(), eveningDate: now.toISODate()! };
}

export const legacyPolicy = (): MediaBroadcastPolicy => ({ profiles: ['lkp'], recommendedAge: null, ratingSource: 'unknown',
  category: 'children', topics: [], intensity: 'moderate', timeOfNight: 'any', retention: 'standard', priority: 50 });

export function mediaPolicy(item: MediaItem, station?: StationConfig): MediaBroadcastPolicy {
  const acquired = item.technical.acquisition as { profile?: ProfileId } | undefined;
  return item.broadcast ?? station?.showPolicies[item.showId] ??
    (acquired?.profile === 'ln' ? { ...legacyPolicy(), profiles: ['ln'], category: 'documentary', recommendedAge: 16, ratingSource: 'editorial' } : legacyPolicy());
}

export function eligibleFor(item: MediaItem, profile: ProfileId, station?: StationConfig, atMs = Date.now()): boolean {
  const p = mediaPolicy(item, station);
  return item.enabled && p.profiles.includes(profile) && (profile !== 'lkp' || (p.recommendedAge ?? 0) < 12) &&
    (!p.expiresAtMs || p.expiresAtMs > atMs);
}

/** Independent runtime guard, including stale/corrupted persisted schedules. */
export function channelEntryAllowed(entry: ScheduleEntry, media: MediaItem | undefined, station: StationConfig, atMs: number): boolean {
  const window = profileWindow(atMs, station);
  if (entry.presentation && entry.presentation.profile !== window.profile) return false;
  if (entry.endsAtMs > window.endsAtMs) return false;
  if (entry.presentation && entry.presentation.kind !== 'programme') {
    const { kind, profile, block } = entry.presentation;
    if (kind === 'ident' && profile === 'lkp' && entry.showId === 'lkp-intermissions') {
      return Boolean(media && media.mediaPath === entry.mediaPath && eligibleFor(media, 'lkp', station, atMs));
    }
    const assetId = kind === 'handover' ? profile === 'ln' ? 'evening' : 'morning'
      : kind === 'gap' ? profile === 'ln' ? 'continuity' : 'day-continuity'
      : kind === 'intro' && typeof block === 'string' ? `intro-${block}`
      : kind === 'outro' ? 'outro' : kind === 'ident' ? 'ident' : undefined;
    if (!assetId || entry.showId !== `station-${profile}` || entry.mediaId !== `station-${assetId}`) return false;
    try {
      const manifest = JSON.parse(fs.readFileSync(station.assetManifest, 'utf8')) as { assets?: Array<{ id?: string; path?: string; fullScreen?: boolean }> };
      const asset = manifest.assets?.find(candidate => candidate.id === assetId);
      return Boolean(asset?.fullScreen && asset.path && path.resolve(asset.path) === path.resolve(entry.mediaPath));
    } catch { return false; }
  }
  if (entry.showId === 'lkp-weather' || entry.showId === 'lkp-intermissions') return window.profile === 'lkp';
  return Boolean(media && media.mediaPath === entry.mediaPath && eligibleFor(media, window.profile, station, atMs));
}

export function profileConfig(config: AppConfig, id: ProfileId): AppConfig {
  const p = config.station?.profiles[id];
  if (!config.station?.enabled || !p) return config;
  return { ...config, logo: { ...config.logo, path: p.logo, width: p.logoWidth,
    transitionRotations: p.animateProgrammeLogo ? config.logo.transitionRotations : 0,
    transitionZoom: p.animateProgrammeLogo ? config.logo.transitionZoom : 1 },
    ...(id === 'ln' ? { comingUp: { enabled: false, minProgrammeMinutes: 16, leadSeconds: 60, durationSeconds: 20 } } : {}),
    ...(config.advertising ? { advertising: { ...config.advertising, enabled: p.advertising && config.advertising.enabled } } : {}) };
}
