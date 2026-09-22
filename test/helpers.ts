import path from 'node:path';
import type { AppConfig, MediaItem } from '../src/types.js';

export function config(root: string): AppConfig {
  return {
    configPath: path.join(root, 'lkp.yaml'), projectRoot: root,
    channel: { name: 'LKP', provider: 'Lundenburg', timezone: 'Europe/Prague', serviceId: 4097, transportStreamId: 4097, originalNetworkId: 65281 },
    media: { root: path.join(root, 'media'), ffprobe: 'ffprobe', supportedExtensions: ['.mp4', '.mkv'], subtitleLanguages: ['cs', 'de', 'en'] },
    storage: { database: path.join(root, 'lkp.sqlite'), runtimeDirectory: path.join(root, 'runtime') },
    schedule: { horizonDays: 365, extendWhenBelowDays: 90, epgDays: 7, seed: 'test-seed' },
    video: { width: 1920, height: 1080, fps: 30, bitrate: '3800k', codec: 'libx264', preset: 'veryfast', decoderThreads: 2, filterThreads: 1, encoderThreads: 2, cpuAffinity: '0,1', audioBitrate: '192k', muxRate: 4976471 },
    logo: { path: path.join(root, 'logo.svg'), width: 220, left: 48, top: 40, opacity: 0.88, transitionDurationMs: 1100, transitionRotations: 3, transitionZoom: 1.08 },
    epg: { output: path.join(root, 'runtime/epg.xml'), language: 'ces', refreshSeconds: 300 },
    broadcast: { mode: 'dvb', frequencyHz: 634000000, gainDb: 14, amplitude: 0.8, fifo: path.join(root, 'runtime/lkp.ts'), transmitter: path.join(root, 'transmit.py') },
    internet: { bind: '127.0.0.1', port: 8080, hlsDirectory: path.join(root, 'runtime/internet/hls'), segmentSeconds: 2, playlistSegments: 8, audioBitrate: '128k' },
  };
}

export function item(showId: string, episode: number, durationMs = 10_000): MediaItem {
  return {
    id: `${showId}-${episode}`, showId, showTitle: `Show ${showId}`, showDescription: `Description ${showId}`,
    defaultLanguage: 'cs', weight: showId === 'a' ? 2 : 1, season: 1, episode, episodeTitle: `Episode ${episode}`,
    description: `Episode ${episode} description`, mediaPath: `/media/${showId}-${episode}.mp4`, durationMs,
    audioLanguage: 'cs', subtitles: [], technical: {}, enabled: true,
  };
}
