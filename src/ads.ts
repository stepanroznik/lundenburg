import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdAsset, AppConfig } from './types.js';
import type { LkpDatabase } from './database.js';
import { SpeechCache } from './weather/speech.js';
import { loadWeatherConfig } from './weather/config.js';
import type { Atom, Presenter } from './weather/model.js';

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
    const metadata = JSON.parse(await execute('yt-dlp', ['--dump-single-json', '--no-playlist', url.toString()])) as YoutubeMetadata;
    if (!metadata.id || !metadata.title) throw new Error('yt-dlp did not return an advertisement ID and title');
    const root = this.config.advertising.root;
    const sourceRoot = path.join(root, 'source');
    const playoutRoot = path.join(root, 'playout');
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(playoutRoot, { recursive: true });
    const template = path.join(sourceRoot, `${metadata.id}.%(ext)s`);
    const downloaded = (await execute('yt-dlp', [
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

const bumperCharacters: Array<{ presenter: Presenter; language: 'de' | 'cs' | 'sk'; text: string }> = [
  { presenter: 'knurpsi', language: 'de', text: 'Werbung' },
  { presenter: 'sisi', language: 'de', text: 'Werbung' },
  { presenter: 'schalinka', language: 'cs', text: 'Reklama' },
  { presenter: 'haluschka', language: 'sk', text: 'Reklama' },
];

export class AdBumperService {
  constructor(private readonly config: AppConfig) {}

  async prepare(mode: 'cache' | 'tts' = 'cache'): Promise<string> {
    if (!this.config.advertising) throw new Error('Advertising is not configured');
    const outputRoot = path.join(this.config.advertising.root, 'bumpers');
    fs.mkdirSync(outputRoot, { recursive: true });
    const speech = new SpeechCache(loadWeatherConfig(), mode);
    const bumpers: Array<{ character: Presenter; mediaPath: string; durationMs: number }> = [];
    for (const definition of bumperCharacters) {
      const atom: Atom = { id: `ad-bumper-${definition.presenter}`, presenter: definition.presenter, language: definition.language, text: definition.text, purpose: 'greeting', period: 'current' };
      const asset = await speech.get(atom, { stability: .72, style: .28 });
      const audio = path.resolve('runtime/weather/public', asset.audio);
      const output = path.join(outputRoot, `${definition.presenter}.mp4`);
      const partial = `${output}.partial.mp4`;
      const font = path.join(this.config.projectRoot, 'assets/weather/fonts/Fredoka.ttf');
      try {
        await execute('ffmpeg', [
          '-hide_banner', '-loglevel', 'warning', '-y',
          '-f', 'lavfi', '-i', `color=c=0x004f4f:s=${this.config.video.width}x${this.config.video.height}:r=25:d=2.5`, '-i', audio,
          '-filter_complex', `[0:v]drawbox=x=180:y=320:w=1560:h=440:color=0xfffcf4:t=fill,drawbox=x=200:y=340:w=1520:h=400:color=0xfb1143:t=8,drawtext=fontfile=${font}:text=WERBUNG:fontcolor=0x004f4f:fontsize=210:x=(w-text_w)/2:y=(h-text_h)/2[v];[1:a]adelay=550|550,apad=pad_dur=2.5[a]`,
          '-map', '[v]', '-map', '[a]', '-t', '2.5', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '50',
          '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', partial,
        ]);
        fs.renameSync(partial, output);
      } finally {
        if (fs.existsSync(partial)) fs.unlinkSync(partial);
      }
      bumpers.push({ character: definition.presenter, mediaPath: output, durationMs: 2_500 });
    }
    const manifest = path.join(outputRoot, 'published.json');
    const temporary = `${manifest}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, bumpers }, null, 2));
    fs.renameSync(temporary, manifest);
    return manifest;
  }
}
