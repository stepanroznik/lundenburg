export type SubtitleKind = 'sidecar' | 'embedded' | 'dvb-bitmap' | 'downloaded';
export type OutputMode = 'dvb' | 'internet' | 'both';
export type CreditsPolicy = 'full' | 'shorten' | 'skip';
export type IngestState = 'ready' | 'review' | 'failed';
export type EditorialMarkerKind = 'chapter' | 'intro' | 'recap' | 'credits' | 'post-credits' | 'ad-break';

export interface ExternalIds { imdb?: string; tmdb?: string; tvdb?: string }

export interface EditorialMarker {
  kind: EditorialMarkerKind;
  startMs: number;
  endMs?: number;
  title?: string;
  source: 'manual' | 'embedded' | 'theintrodb' | 'chaptersdb' | 'local';
  confidence: number;
}

export interface Breakpoint {
  atMs: number;
  score: number;
  confidence: number;
  reason: string[];
  source: 'manual' | 'known' | 'chapter' | 'local';
  enabled: boolean;
}

export interface SubtitleTrack {
  language: string;
  kind: SubtitleKind;
  path?: string;
  streamIndex?: number;
  codec?: string;
  provider?: string;
  providerId?: string;
  releaseName?: string;
  sourceFps?: number;
  hearingImpaired?: boolean;
  syncStatus?: 'unknown' | 'verified' | 'adjusted' | 'failed';
}

export interface MediaItem {
  id: string;
  showId: string;
  showTitle: string;
  showDescription: string;
  defaultLanguage?: string;
  weight: number;
  season?: number;
  episode?: number;
  episodeTitle: string;
  description: string;
  mediaPath: string;
  durationMs: number;
  audioLanguage?: string;
  subtitles: SubtitleTrack[];
  technical: Record<string, unknown>;
  enabled: boolean;
  externalIds?: ExternalIds;
  editorialMarkers?: EditorialMarker[];
  creditsPolicy?: CreditsPolicy;
  effectiveEditorialDurationMs?: number;
  breakpoints?: Breakpoint[];
  ingestState?: IngestState;
  qcWarnings?: string[];
}

export interface AdAsset {
  id: string;
  title: string;
  advertiser?: string;
  sourceUrl: string;
  language: string;
  durationMs: number;
  mediaPath: string;
  enabled: boolean;
  tags: string[];
  ageSuitability?: string;
  sourceMetadata: Record<string, unknown>;
  lastUsedAtMs?: number;
}

export type PlayoutSegment =
  | { type: 'content' | 'credits'; mediaPath: string; fromMs: number; toMs: number; durationMs: number }
  | { type: 'ad-ident'; mediaPath: string; durationMs: number; character: 'knurpsi' | 'sisi' | 'schalinka' | 'haluschka' }
  | { type: 'ad'; mediaPath: string; durationMs: number; adId: string }
  | { type: 'intermission'; mediaPath: string; durationMs: number; intermissionId: string };

export interface PlayoutPlan {
  version: 1;
  programmeEventId: string;
  sourceDurationMs: number;
  durationMs: number;
  segments: PlayoutSegment[];
  warnings: string[];
}

export interface ScheduleEntry {
  id: string;
  sequence: number;
  mediaId: string;
  showId: string;
  showTitle: string;
  season?: number;
  episode?: number;
  episodeTitle: string;
  description: string;
  startsAtMs: number;
  endsAtMs: number;
  durationMs: number;
  mediaPath: string;
  audioLanguage?: string;
  subtitleLanguages: string[];
  listingVisibility?: 'public' | 'hidden';
  playoutPlan?: PlayoutPlan;
}

export interface PlaybackEvent {
  id: string;
  scheduleEntryId: string;
  plannedStartMs: number;
  plannedEndMs: number;
  actualStartMs: number;
  actualEndMs?: number;
  initialSeekMs: number;
  coldStartResume: boolean;
  status: 'started' | 'completed' | 'failed' | 'interrupted';
  error?: string;
}

export interface IntermissionConfig {
  enabled: boolean; manifest: string; boundaryRate: number;
  weights: { ident: number; silent: number; voiced: number };
}

export interface AdvertisingConfig {
  enabled: boolean;
  root: string;
  programmeInterval: number;
  minEditorialMinutes: number;
  targetSeconds: { min: number; max: number };
  searchWindowMinutes: number;
  minimumBreakpointScore: number;
  bumperManifest: string;
}

export interface AppConfig {
  intermissions?: IntermissionConfig;
  advertising?: AdvertisingConfig;
  configPath: string;
  projectRoot: string;
  channel: {
    name: string; provider: string; timezone: string;
    serviceId: number; transportStreamId: number; originalNetworkId: number;
  };
  media: {
    root: string; generatedRoot: string; mountPoint?: string;
    ffprobe: string; supportedExtensions: string[]; subtitleLanguages: string[];
  };
  storage: { database: string; runtimeDirectory: string };
  schedule: { horizonDays: number; extendWhenBelowDays: number; epgDays: number; seed: string };
  video: {
    width: number; height: number; fps: number; bitrate: string; codec: string;
    preset: string; decoderThreads: number; filterThreads: number; encoderThreads: number; cpuAffinity: string; audioBitrate: string; muxRate: number;
  };
  logo: {
    path: string; width: number; left: number; top: number; opacity: number;
    transitionDurationMs: number; transitionRotations: number; transitionZoom: number;
  };
  epg: { output: string; language: string; refreshSeconds: number };
  broadcast: {
    mode: OutputMode;
    frequencyHz: number; gainDb: number; amplitude: number; fifo: string; transmitter: string;
  };
  internet: {
    bind: string; port: number; hlsDirectory: string; segmentSeconds: number;
    playlistSegments: number; audioBitrate: string;
  };
}
