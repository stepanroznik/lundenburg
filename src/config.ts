import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { AppConfig } from './types.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function requiredObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Configuration section '${name}' must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(o: Record<string, unknown>, key: string): string {
  if (typeof o[key] !== 'string' || !o[key]) throw new Error(`Configuration '${key}' must be a non-empty string`);
  return o[key] as string;
}

function numberValue(o: Record<string, unknown>, key: string): number {
  if (typeof o[key] !== 'number' || !Number.isFinite(o[key])) throw new Error(`Configuration '${key}' must be a number`);
  return o[key] as number;
}

function resolveFromProject(projectRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

export function loadConfig(explicitPath?: string): AppConfig {
  const projectRoot = sourceRoot.endsWith(`${path.sep}dist`) ? path.dirname(sourceRoot) : sourceRoot;
  const configPath = path.resolve(explicitPath ?? process.env.LKP_CONFIG ?? path.join(projectRoot, 'config/lkp.yaml'));
  const raw = parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  const channel = requiredObject(raw.channel, 'channel');
  const media = requiredObject(raw.media, 'media');
  const storage = requiredObject(raw.storage, 'storage');
  const schedule = requiredObject(raw.schedule, 'schedule');
  const video = requiredObject(raw.video, 'video');
  const logo = requiredObject(raw.logo, 'logo');
  const epg = requiredObject(raw.epg, 'epg');
  const broadcast = requiredObject(raw.broadcast, 'broadcast');
  const mediaRoot = process.env.LKP_MEDIA_ROOT ?? stringValue(media, 'root');
  const database = process.env.LKP_DATABASE ?? stringValue(storage, 'database');

  const result: AppConfig = {
    configPath,
    projectRoot,
    channel: {
      name: stringValue(channel, 'name'), provider: stringValue(channel, 'provider'), timezone: stringValue(channel, 'timezone'),
      serviceId: numberValue(channel, 'serviceId'), transportStreamId: numberValue(channel, 'transportStreamId'),
      originalNetworkId: numberValue(channel, 'originalNetworkId'),
    },
    media: {
      root: path.resolve(mediaRoot), ffprobe: stringValue(media, 'ffprobe'),
      supportedExtensions: (media.supportedExtensions as unknown[]).map(String).map((x) => x.toLowerCase()),
      subtitleLanguages: (media.subtitleLanguages as unknown[]).map(String),
    },
    storage: {
      database: resolveFromProject(projectRoot, database),
      runtimeDirectory: resolveFromProject(projectRoot, stringValue(storage, 'runtimeDirectory')),
    },
    schedule: {
      horizonDays: numberValue(schedule, 'horizonDays'), extendWhenBelowDays: numberValue(schedule, 'extendWhenBelowDays'),
      epgDays: numberValue(schedule, 'epgDays'), seed: stringValue(schedule, 'seed'),
    },
    video: {
      width: numberValue(video, 'width'), height: numberValue(video, 'height'), fps: numberValue(video, 'fps'),
      bitrate: stringValue(video, 'bitrate'), codec: stringValue(video, 'codec'), preset: stringValue(video, 'preset'),
      decoderThreads: video.decoderThreads === undefined ? 2 : numberValue(video, 'decoderThreads'),
      filterThreads: video.filterThreads === undefined ? 1 : numberValue(video, 'filterThreads'),
      encoderThreads: numberValue(video, 'encoderThreads'), cpuAffinity: stringValue(video, 'cpuAffinity'),
      audioBitrate: stringValue(video, 'audioBitrate'),
      muxRate: numberValue(video, 'muxRate'),
    },
    logo: {
      path: resolveFromProject(projectRoot, stringValue(logo, 'path')), width: numberValue(logo, 'width'),
      left: numberValue(logo, 'left'), top: numberValue(logo, 'top'), opacity: numberValue(logo, 'opacity'),
      transitionDurationMs: numberValue(logo, 'transitionDurationMs'), transitionRotations: numberValue(logo, 'transitionRotations'),
      transitionZoom: numberValue(logo, 'transitionZoom'),
    },
    epg: {
      output: resolveFromProject(projectRoot, stringValue(epg, 'output')), language: stringValue(epg, 'language'),
      refreshSeconds: numberValue(epg, 'refreshSeconds'),
    },
    broadcast: {
      frequencyHz: numberValue(broadcast, 'frequencyHz'), gainDb: Number(process.env.LKP_GAIN_DB ?? numberValue(broadcast, 'gainDb')),
      amplitude: numberValue(broadcast, 'amplitude'), fifo: resolveFromProject(projectRoot, stringValue(broadcast, 'fifo')),
      transmitter: resolveFromProject(projectRoot, stringValue(broadcast, 'transmitter')),
    },
  };
  if (result.broadcast.gainDb < 0 || result.broadcast.gainDb > 30) throw new Error('broadcast.gainDb must be between 0 and 30');
  if (!Number.isInteger(result.video.encoderThreads) || result.video.encoderThreads < 1) throw new Error('video.encoderThreads must be a positive integer');
  if (!/^[0-9,-]+$/.test(result.video.cpuAffinity)) throw new Error('video.cpuAffinity must be a CPU list such as 0,1');
  for (const key of ['decoderThreads', 'filterThreads'] as const) {
    if (!Number.isInteger(result.video[key]) || result.video[key] < 1) throw new Error(`video.${key} must be a positive integer`);
  }
  if (!Number.isInteger(result.logo.width) || result.logo.width < 1) throw new Error('logo.width must be a positive integer');
  if (result.logo.transitionDurationMs <= 0 || result.logo.transitionZoom < 1) throw new Error('Logo transition requires positive duration and zoom >= 1');
  if (result.logo.opacity < 0 || result.logo.opacity > 1) throw new Error('logo.opacity must be between 0 and 1');
  return result;
}
