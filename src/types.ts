export type SubtitleKind = 'sidecar' | 'embedded' | 'dvb-bitmap';

export interface SubtitleTrack {
  language: string;
  kind: SubtitleKind;
  path?: string;
  streamIndex?: number;
  codec?: string;
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

export interface AppConfig {
  configPath: string;
  projectRoot: string;
  channel: {
    name: string; provider: string; timezone: string;
    serviceId: number; transportStreamId: number; originalNetworkId: number;
  };
  media: {
    root: string; ffprobe: string; supportedExtensions: string[]; subtitleLanguages: string[];
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
    frequencyHz: number; gainDb: number; amplitude: number; fifo: string; transmitter: string;
  };
}
