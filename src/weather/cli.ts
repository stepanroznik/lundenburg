import fs from 'node:fs';
import path from 'node:path';
import { Command, Option } from 'commander';
import { DateTime } from 'luxon';
import { loadConfig } from '../config.js';
import { LkpDatabase } from '../database.js';
import { writeEpgAtomic } from '../epg.js';
import { loadWeatherConfig, presenters } from './config.js';
import { editionWindow, fixtures, mockForecast, OpenMeteoProvider } from './forecast.js';
import { speechPlan } from './narration.js';
import { SpeechCache, probeDuration } from './speech.js';
import { assembleEpisode, subtitles } from './episode.js';
import { renderEpisode } from './render.js';
import { prepareMap } from './map.js';
import { publishWeather } from './publish.js';
import type { Edition, Episode, ProgrammeMetadata } from './model.js';

const program = new Command().name('lkp-weather');
const c = loadWeatherConfig();
interface GenerateOptions { edition: Edition; at?: string; fixture?: string; audio: 'tts' | 'cache' | 'silent'; presenter?: string; render?: boolean; publish?: boolean }
const json = (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
function broadcastTime(options: GenerateOptions): Date {
  const at = options.at ? DateTime.fromISO(options.at, { zone: c.timezone }) : DateTime.now().setZone(c.timezone).startOf('day').set({ hour: c.starts[options.edition] });
  if (!at.isValid) throw new Error('Invalid broadcast time');
  const window = editionWindow(options.edition, at.toJSDate(), c);
  if (at < window.from || at >= window.until) throw new Error('Broadcast time is outside the selected edition');
  if (!options.fixture && at.toMillis() < Date.now() - 60_000) throw new Error('Live generation needs a future --at broadcast time; use --fixture for historical previews');
  return at.toJSDate();
}
async function generate(options: GenerateOptions): Promise<string> {
  const at = broadcastTime(options);
  const preview = Boolean(options.fixture || options.audio === 'silent' || options.presenter);
  if (options.publish && preview) throw new Error('Preview editions cannot be published');
  if ((options.render || options.publish) && !fs.existsSync('assets/weather/region.json')) throw new Error('Run npm run weather:map before generating speech for a render');
  const date = DateTime.fromJSDate(at, { zone: c.timezone }).toISODate()!;
  const directory = path.resolve(`runtime/weather/episodes/${date}/${options.edition}${preview ? '-preview' : ''}`);
  fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, '.lock');
  fs.closeSync(fs.openSync(lock, 'wx'));
  const started = Date.now();
  const speech = new SpeechCache(c, options.audio);
  try {
    if (fs.existsSync(path.join(directory, 'scheduled.json'))) throw new Error('This edition is already scheduled; keep its media immutable');
    const result = options.fixture ? { forecast: mockForecast(options.fixture, at, options.edition), source: { fixture: options.fixture } } : await new OpenMeteoProvider(c, 'runtime/weather/forecast').getForecast(at, options.edition);
    json(path.join(directory, 'weather-source.json'), result.source);
    json(path.join(directory, 'normalized-forecast.json'), result.forecast);
    let atoms = await speechPlan(result.forecast, options.edition);
    if (options.presenter) atoms = atoms.filter(a => a.presenter === options.presenter);
    if (!atoms.length) throw new Error('No speech atoms selected');
    json(path.join(directory, 'script.json'), atoms);
    const episode = await assembleEpisode(result.forecast, options.edition, atoms, atom => speech.get(atom), c.fps, preview);
    json(path.join(directory, 'timeline.json'), episode);
    fs.writeFileSync(path.join(directory, 'subtitles.vtt'), subtitles(episode, 'vtt'));
    fs.writeFileSync(path.join(directory, 'weather.srt'), subtitles(episode, 'srt'));
    for (const language of ['de', 'cs', 'sk']) fs.writeFileSync(path.join(directory, `weather.${language}.srt`), subtitles(episode, 'srt', language));
    json(path.join(directory, 'generation-report.json'), { edition: options.edition, provider: result.forecast.provider, fetchedAt: result.forecast.fetchedAt, staleWeather: result.forecast.stale, speech: speech.stats, llmUsed: false, preview, generationMs: Date.now() - started, renderSuccess: false });
    console.log(`Prepared ${atoms.length} speech atoms; ${speech.stats.hits} cached, ${speech.stats.misses} generated.\n${directory}`);
    if (options.render || options.publish) await render(directory, {});
    if (options.publish) publish(directory, at.getTime());
    return directory;
  } catch (error) {
    json(path.join(directory, 'failure.json'), { at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error), speech: speech.stats });
    throw error;
  } finally { fs.unlinkSync(lock); }
}
async function render(directory: string, options: { still?: string; scale?: string; frames?: string }) {
  const episode = JSON.parse(fs.readFileSync(path.join(directory, 'timeline.json'), 'utf8')) as Episode;
  const frame = options.still === undefined ? undefined : Number(options.still);
  const scale = options.scale === undefined ? 1 : Number(options.scale);
  const range = options.frames?.split('-').map(Number);
  if (!(scale > 0 && scale <= 1) || (frame !== undefined && (!Number.isInteger(frame) || frame < 0 || frame >= episode.durationInFrames))) throw new Error('Invalid render scale/frame');
  if (range && (range.length !== 2 || range.some(n => !Number.isInteger(n)) || range[0]! < 0 || range[1]! < range[0]! || range[1]! >= episode.durationInFrames)) throw new Error('Invalid --frames start-end');
  const partial = Boolean(range || frame !== undefined || scale !== 1);
  const output = path.join(directory, frame !== undefined ? 'preview.png' : partial ? 'preview.mp4' : 'weather.mp4');
  if (!partial && fs.existsSync(path.join(directory, 'scheduled.json'))) throw new Error('Scheduled programme media is immutable');
  const temporary = output.replace(/\.(png|mp4)$/, '.rendering.$1');
  const started = Date.now();
  await renderEpisode(episode, temporary, c, { scale, ...(frame === undefined ? {} : { still: frame }), ...(range ? { frames: range as [number, number] } : {}) });
  fs.renameSync(temporary, output);
  if (!partial) {
    const at = new Date(episode.broadcastAt);
    const window = editionWindow(episode.edition, at, c);
    const expires = Math.min(window.until.toMillis(), Date.parse(episode.forecast.fetchedAt) + c.maxForecastAgeMinutes * 60_000);
    const metadata: ProgrammeMetadata = { id: `weather-${DateTime.fromJSDate(at, { zone: c.timezone }).toISODate()}-${episode.edition}`, title: `Die Wetterfreunde · ${episode.edition}`, edition: episode.edition, generatedAt: new Date().toISOString(), validFrom: at.toISOString(), validUntil: new Date(expires).toISOString(), durationMs: Math.round(await probeDuration(output) * 1000), mediaPath: path.resolve(output), subtitlePath: path.resolve(directory, 'subtitles.vtt'), preview: episode.preview };
    json(path.join(directory, 'programme.json'), metadata);
    const reportFile = path.join(directory, 'generation-report.json');
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
    json(reportFile, { ...report, renderSuccess: true, renderMs: Date.now() - started, output });
  }
  console.log(`Rendered ${output}`);
}
function publish(directory: string, atMs: number) {
  const config = loadConfig();
  const db = new LkpDatabase(config.storage.database);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(directory, 'programme.json'), 'utf8')) as ProgrammeMetadata;
    const entry = publishWeather(meta, db, config, atMs);
    writeEpgAtomic(db.listSchedule(Date.now() - 86400000, Date.now() + config.schedule.epgDays * 86400000), config);
    console.log(`Scheduled ${entry.episodeTitle} at ${new Date(entry.startsAtMs).toISOString()}`);
  } finally { db.close(); }
}
program.command('map').description('download a reusable real OSM railway/river snapshot').action(prepareMap);
program.command('generate').addOption(new Option('--edition <edition>').choices(['morning', 'afternoon', 'evening']).default('morning'))
  .option('--at <time>', 'intended broadcast time (ISO; Prague if no offset)')
  .addOption(new Option('--fixture <fixture>').choices([...fixtures]))
  .addOption(new Option('--audio <mode>').choices(['tts', 'cache', 'silent']).default('tts'))
  .addOption(new Option('--presenter <presenter>').choices(presenters.map(p => p.id)))
  .option('--render', 'render after speech preparation')
  .option('--publish', 'render and insert at a future schedule boundary, shifting later programmes')
  .action(async (options: GenerateOptions) => { await generate(options); });
program.command('render').requiredOption('--episode <directory>').option('--still <frame>').option('--scale <factor>').option('--frames <start-end>').action(async (o: { episode: string; still?: string; scale?: string; frames?: string }) => render(path.resolve(o.episode), o));
program.command('publish').requiredOption('--episode <directory>').action((o: { episode: string }) => publish(path.resolve(o.episode), Date.now() + 60_000));
program.command('fetch').addOption(new Option('--edition <edition>').choices(['morning', 'afternoon', 'evening']).default('morning')).requiredOption('--at <time>').action(async (o: GenerateOptions) => {
  const result = await new OpenMeteoProvider(c, 'runtime/weather/forecast').getForecast(broadcastTime(o), o.edition);
  console.log(JSON.stringify(result.forecast, null, 2));
});
program.command('auto').description('generate the due edition using fresh weather and a future schedule boundary').action(async () => {
  const config = loadConfig(), db = new LkpDatabase(config.storage.database);
  let next: { edition: Edition; at: string } | undefined;
  try {
    for (const edition of ['morning', 'afternoon', 'evening'] as const) {
      const window = editionWindow(edition, new Date(), c);
      if (Date.now() < window.from.toMillis() - c.generationLeadMinutes * 60_000 || Date.now() >= window.until.toMillis()) continue;
      const date = window.from.toISODate();
      if (db.db.prepare('SELECT id FROM schedule_entries WHERE media_id=?').get(`weather-${date}-${edition}`)) continue;
      const boundary = db.nextAfter(Math.max(window.from.toMillis(), Date.now() + c.generationLeadMinutes * 60_000));
      if (boundary && boundary.startsAtMs < window.until.toMillis()) { next = { edition, at: new Date(boundary.startsAtMs).toISOString() }; break; }
    }
  } finally { db.close(); }
  if (next) await generate({ ...next, audio: 'tts', publish: true });
  else console.log('No weather edition due at an eligible schedule boundary.');
});
program.command('usage').action(() => {
  const file = 'runtime/weather/usage.jsonl';
  const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { at: string; presenter: string; characters: number; hit: boolean }) : [];
  const now = DateTime.now().setZone(c.timezone);
  for (const [name, cutoff] of [['Today', now.startOf('day')], ['This month', now.startOf('month')]] as const) {
    const selected = rows.filter(r => Date.parse(r.at) >= cutoff.toMillis());
    console.log(JSON.stringify({ period: name, newCharacters: selected.reduce((s, r) => s + r.characters, 0), cacheHitRate: selected.length ? selected.filter(r => r.hit).length / selected.length : 0, presenters: Object.fromEntries(presenters.map(p => [p.id, selected.filter(r => r.presenter === p.id).reduce((s, r) => s + r.characters, 0)])) }));
  }
});
program.parseAsync().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
