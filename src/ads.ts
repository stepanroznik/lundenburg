import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdAsset, AppConfig } from './types.js';
import type { LkpDatabase } from './database.js';
import { SpeechCache } from './weather/speech.js';
import { loadWeatherConfig } from './weather/config.js';
import type { Atom } from './weather/model.js';
import { bumperDefinitions, bumperFilm } from './advertising/model.js';
import { renderBumpers } from './advertising/render.js';
import { assertMediaStorage } from './media-storage.js';

const run = promisify(execFile);

export const initialAdUrls = [
  'https://www.youtube.com/watch?v=oXpsHPRxJSM',
  'https://www.youtube.com/watch?v=KfPIolJETzQ',
  'https://www.youtube.com/watch?v=YCTBOzkAKeY',
  'https://www.youtube.com/watch?v=ul8VKc2Fv58',
  'https://www.youtube.com/watch?v=FzcUHCE4l6A',
  'https://www.youtube.com/watch?v=fmhwlUvEeNk',
];

interface YoutubeMetadata {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  language?: string;
  duration?: number;
  webpage_url?: string;
  [key: string]: unknown;
}

export interface AdIngestOptions {
  language?: string;
  advertiser?: string;
  tags?: string[];
  ageSuitability?: string;
}

function allowedUrl(value: string): URL {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (!['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'].includes(url.hostname)) throw new Error('Only YouTube advertisement URLs are supported');
  return url;
}

async function execute(command: string, args: string[]): Promise<string> {
  try {
    const result = await run(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return result.stdout.trim();
  } catch (error) {
    const value = error as Error & { stderr?: string; code?: string | number };
    throw new Error(`${command} failed${value.code !== undefined ? ` (${value.code})` : ''}: ${value.stderr?.trim() || value.message}`);
  }
}

export class AdIngestService {
  constructor(private readonly config: AppConfig, private readonly db: LkpDatabase) {}

  async ingest(sourceUrl: string, options: AdIngestOptions = {}): Promise<AdAsset> {
    if (!this.config.advertising) throw new Error('Advertising is not configured');
    const url = allowedUrl(sourceUrl);
    const projectDownloader = path.join(this.config.projectRoot, 'runtime/tools/yt-dlp/bin/yt-dlp');
    const authenticatedDownloader = path.join(this.config.projectRoot, 'scripts/youtube-ad-downloader.py');
    const authenticationInstalled = fs.existsSync(path.join(this.config.projectRoot, 'runtime/tools/youtube-ads/venv/bin/yt-dlp')) && fs.existsSync(authenticatedDownloader);
    const downloader = process.env.LKP_YT_DLP ?? (authenticationInstalled ? authenticatedDownloader : fs.existsSync(projectDownloader) ? projectDownloader : 'yt-dlp');
    const metadata = JSON.parse(await execute(downloader, ['--dump-single-json', '--no-playlist', url.toString()])) as YoutubeMetadata;
    if (!metadata.id || !metadata.title) throw new Error('yt-dlp did not return an advertisement ID and title');
    const root = this.config.advertising.root;
    const sourceRoot = path.join(root, 'source');
    const playoutRoot = path.join(root, 'playout');
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(playoutRoot, { recursive: true });
    const template = path.join(sourceRoot, `${metadata.id}.%(ext)s`);
    const downloaded = (await execute(downloader, [
      '--no-playlist', '--format', 'bv*+ba/b', '--merge-output-format', 'mkv',
      '--output', template, '--print', 'after_move:filepath', url.toString(),
    ])).split(/\r?\n/).filter(Boolean).at(-1);
    if (!downloaded || !fs.existsSync(downloaded)) throw new Error('yt-dlp completed without a readable source file');
    const output = path.join(playoutRoot, `${metadata.id}.mp4`);
    const partial = `${output}.partial.mp4`;
    try {
      await execute('ffmpeg', [
        '-hide_banner', '-loglevel', 'warning', '-y', '-i', downloaded,
        '-vf', `scale=${this.config.video.width}:${this.config.video.height}:force_original_aspect_ratio=decrease,pad=${this.config.video.width}:${this.config.video.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=25`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', partial,
      ]);
      const probe = JSON.parse(await execute(this.config.media.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', partial])) as { format?: { duration?: string }; streams?: Array<Record<string, unknown>> };
      const durationMs = Math.round(Number(probe.format?.duration) * 1000);
      const video = probe.streams?.find((stream) => stream.codec_type === 'video');
      const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
      if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || video?.codec_name !== 'h264' || video.width !== 1920 || video.height !== 1080 || video.pix_fmt !== 'yuv420p' || video.avg_frame_rate !== '25/1' || audio?.codec_name !== 'aac' || Number(audio.sample_rate) !== 48000 || audio.channels !== 2) throw new Error('Normalized advertisement failed playout-profile QC');
      fs.renameSync(partial, output);
      const ad: AdAsset = {
        id: metadata.id, title: metadata.title,
        ...(options.advertiser ?? metadata.uploader ?? metadata.channel ? { advertiser: options.advertiser ?? metadata.uploader ?? metadata.channel } : {}),
        sourceUrl: metadata.webpage_url ?? url.toString(), language: options.language ?? metadata.language ?? 'de',
        durationMs, mediaPath: output, enabled: true, tags: options.tags ?? [],
        ...(options.ageSuitability ? { ageSuitability: options.ageSuitability } : {}), sourceMetadata: metadata,
      };
      this.db.upsertAd(ad);
      return ad;
    } finally {
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
    }
  }
}

export class AdBumperService {
  constructor(private readonly config: AppConfig) {}

  async prepare(mode: 'cache' | 'tts' = 'cache', stills = false): Promise<string> {
    if (!this.config.advertising) throw new Error('Advertising is not configured');
    assertMediaStorage(this.config);
    const speech = new SpeechCache(loadWeatherConfig(), mode);
    const films = [];
    for (const definition of bumperDefinitions) {
      const atom: Atom = { id: `ad-bumper-${definition.presenter}`, presenter: definition.presenter,
        language: definition.language, text: definition.text, purpose: 'greeting', period: 'current' };
      films.push(bumperFilm(definition, await speech.get(atom, { stability: .72, style: .28 })));
    }
    return renderBumpers(films, path.join(this.config.advertising.root, 'bumpers'), this.config.media.ffprobe, stills);
  }
}
