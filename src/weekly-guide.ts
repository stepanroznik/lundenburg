import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { DateTime } from 'luxon';
import { openBrowser } from '@remotion/renderer';
import { publicSchedule } from './listing.js';
import { profileWindow } from './channels.js';
import { nacht } from './branding/identity.js';
import { isCatalogueMovie } from './catalogue.js';
import { stableId } from './util.js';
import type { AppConfig, MediaItem, ScheduleEntry } from './types.js';

const run = promisify(execFile);
const colors = ['#dc284c', '#e67819', '#e8b72a', '#62a644', '#189a9c', '#2582c6', '#8555a4'];
const weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const shortTitles: Record<string, string> = {
  'ms-rachel': 'Ms Rachel', 'miss-josi': 'Miss Josi',
  'sendung-mit-dem-elefanten': 'Mit dem Elefanten',
  'unser-sandmaennchen': 'Sandmännchen',
  'bobo-siebenschlaefer': 'Bobo',
  'byl-jednou-jeden-zivot': '… das Leben',
  'kurzgesagt-ln': 'Kurzgesagt',
};
// Print copy is deliberately shorter than EPG or acquisition descriptions.
const featureDescriptions: Record<string, string> = {
  bluey: 'Bluey und Bingo verwandeln den Alltag in fantasievolle Spiele.',
  'bob-a-bobek': 'Zwei Kaninchen, ein Zauberhut und jede Menge Abenteuer.',
  'bobo-siebenschlaefer': 'Mit Bobo die kleinen Abenteuer des Alltags entdecken.',
  'der-kleine-maulwurf': 'Der kleine Maulwurf entdeckt die Natur und hilft seinen Freunden.',
  'sendung-mit-dem-elefanten': 'Lach- und Sachgeschichten für kleine Entdecker.',
  'tom-und-jerry': 'Eine Katze, eine Maus und eine turbulente Verfolgungsjagd.',
  rakosnicek: 'Der kleine grüne Freund erlebt Abenteuer am Teich.',
  'unser-sandmaennchen': 'Eine kleine Geschichte zum Träumen und Einschlafen.',
  sesamstrasse: 'Mit Ernie, Bert und ihren Freunden spielerisch die Welt entdecken.',
  'servus-kasperl': 'Vorhang auf für Kasperl und seine lustigen Abenteuer!',
  teletubbies: 'Farben, Bewegung und neue Entdeckungen im Teletubby-Land.',
  'ms-rachel': 'Englische Wörter, Lieder und Spiele für die Kleinsten.',
  'miss-josi': 'Singen, sprechen und bewegen: spielerisch Neues lernen.',
  'tolle-tiere': 'Tiere kennenlernen und über ihre Welt staunen.',
};

export interface GuideDay {
  date: string;
  startsAtMs: number;
  endsAtMs: number;
  handover: string | undefined;
  kids: ScheduleEntry[];
  night: ScheduleEntry[];
  feature?: ScheduleEntry;
}
export interface GuideOptions {
  week?: string;
  artwork?: string;
  browser?: string;
  media?: MediaItem[];
}

/** A broadcast day follows the station's morning boundary, including DST. */
export function guideWeek(value: string | undefined, config: AppConfig): { start: DateTime; end: DateTime } {
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Week must be an ISO date (YYYY-MM-DD)');
  const zone = config.channel.timezone;
  const reference = value ? DateTime.fromISO(value, { zone }) : DateTime.now().setZone(zone);
  if (!reference.isValid) throw new Error('Invalid guide week');
  const morning = config.station?.enabled ? config.station.hours.morningEnd : '06:00';
  const start = reference.startOf('week').set({ hour: Number(morning.slice(0, 2)), minute: Number(morning.slice(3)) });
  return { start, end: start.plus({ days: 7 }) };
}

function profile(entry: ScheduleEntry, config: AppConfig): 'lkp' | 'ln' {
  return entry.presentation?.profile ?? (config.station?.enabled ? profileWindow(entry.startsAtMs, config.station).profile : 'lkp');
}

function featureScore(entry: ScheduleEntry, zone: string): number {
  const hour = DateTime.fromMillis(entry.startsAtMs, { zone }).hour;
  return Math.min(entry.durationMs / 60_000, 35) + (hour >= 14 && hour < 19 ? 45 : hour >= 9 ? 15 : 0);
}

/** Match days to shows so a scarce show cannot force an avoidable repeat. */
export function selectGuideFeatures(days: GuideDay[], zone: string): void {
  const choices = days.map((day, dayIndex) => {
    const shows = new Map<string, ScheduleEntry>();
    for (const entry of day.kids) {
      if (entry.showId.startsWith('lkp-')) continue;
      const previous = shows.get(entry.showId);
      if (!previous || featureScore(entry, zone) > featureScore(previous, zone)) shows.set(entry.showId, entry);
    }
    return [...shows.values()].sort((a, b) => featureScore(b, zone) - featureScore(a, zone) ||
      stableId(dayIndex, a.showId).localeCompare(stableId(dayIndex, b.showId)));
  });
  const owner = new Map<string, number>();
  const assigned = new Map<number, ScheduleEntry>();
  const match = (day: number, seen: Set<string>): boolean => {
    const available = choices[day]!.filter(entry => !owner.has(entry.showId));
    const occupied = choices[day]!.filter(entry => owner.has(entry.showId));
    for (const entry of [...available, ...occupied]) {
      if (seen.has(entry.showId)) continue;
      seen.add(entry.showId);
      const old = owner.get(entry.showId);
      if (old === undefined || match(old, seen)) {
        owner.set(entry.showId, day);
        assigned.set(day, entry);
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < days.length; i++) match(i, new Set());
  days.forEach((day, i) => {
    const feature = assigned.get(i) ?? choices[i]?.[0];
    if (feature) day.feature = feature;
  });
}

export function buildWeeklyGuide(entries: ScheduleEntry[], config: AppConfig, week?: string): GuideDay[] {
  const { start } = guideWeek(week, config);
  // Presentation-only station films must never become public programme rows.
  const visible = publicSchedule([...entries].sort((a, b) => a.startsAtMs - b.startsAtMs))
    .filter(entry => !entry.presentation || entry.presentation.kind === 'programme');
  const days = Array.from({ length: 7 }, (_, i): GuideDay => {
    const from = start.plus({ days: i });
    const to = from.plus({ days: 1 });
    // Retain a genuine programme already in progress at the morning boundary.
    const daily = visible.filter(entry => entry.startsAtMs < to.toMillis() && entry.endsAtMs > from.toMillis());
    return {
      date: from.toISODate()!, startsAtMs: from.toMillis(), endsAtMs: to.toMillis(),
      handover: config.station?.enabled ? from.weekday >= 6 ? config.station.hours.weekendStart : config.station.hours.weekdayStart : undefined,
      kids: daily.filter(entry => profile(entry, config) === 'lkp'),
      night: daily.filter(entry => profile(entry, config) === 'ln'),
    };
  });
  selectGuideFeatures(days, config.channel.timezone);
  return days;
}

/** Only a short synopsis; discard cast/crew and promotional boilerplate. */
export function guideDescription(text: string, limit = 110): string {
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(sentence =>
    !/\b(Regie|Darsteller\w*|Schauspiel\w*|Besetzung|Hauptrolle\w*|Sprecher\w*|Synchron\w*|cast|actor\w*|starring|director|subscribe|abonnier\w*|Mitwirkende|moderiert|Moderation)\b|\bmit\s*:/i.test(sentence));
  const first = sentences[0] ?? '';
  if (first.length <= limit) return first;
  return first.slice(0, limit - 1).replace(/\s+\S*$/, '').replace(/[,:;.!?]+$/, '') + '…';
}

const html = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const dataUri = (file: string, mime: string) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

/** Adjacent public airings form one print listing; stored events stay intact. */
export function groupGuideEntries(entries: readonly ScheduleEntry[]): ScheduleEntry[][] {
  const groups: ScheduleEntry[][] = [];
  for (const entry of entries) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (previous && previous.showId === entry.showId && previous.endsAtMs === entry.startsAtMs &&
      previous.presentation?.profile === entry.presentation?.profile) group!.push(entry);
    else groups.push([entry]);
  }
  return groups;
}

/** Preserve playback order across both assembled slots and grouped airings. */
export function guideEpisodeNumbers(input: ScheduleEntry | readonly ScheduleEntry[], media: ReadonlyMap<string, MediaItem>): string | undefined {
  const entries = 'id' in input ? [input] : input;
  const numbers = entries.flatMap<{ season: number | undefined; episode: number | undefined; part: number | undefined; parts: number | undefined }>(entry => {
    const sources = entry.playoutPlan?.assembly?.sources;
    const first = media.get(entry.mediaId);
    if (first && isCatalogueMovie(first)) return [];
    if (sources?.length) return sources.map(source => {
      const item = media.get(source.mediaId);
      return { season: item?.season, episode: item?.episode, part: source.part, parts: source.parts };
    });
    // Retain explicit upload numbering on older UnusualVideos listings.
    const legacy = entry.showId === 'unusualvideos' ? entry.episodeTitle.match(/\bV(\d+)\b/i)?.[1] : undefined;
    return [{ season: entry.season ?? first?.season, episode: entry.episode ?? first?.episode ?? (legacy ? Number(legacy) : undefined), part: undefined, parts: undefined }];
  });
  const groups: string[] = [];
  let previousSeason: number | undefined;
  for (let i = 0; i < numbers.length; i++) {
    const item = numbers[i]!;
    if (item.episode === undefined || !Number.isSafeInteger(item.episode) || item.episode < 0) continue;
    const season = item.season;
    const start = item.episode;
    let end = start;
    if (!item.part) {
      while (i + 1 < numbers.length) {
        const next = numbers[i + 1]!;
        if (next.part || next.season !== season || next.episode !== end + 1) break;
        end = next.episode;
        i++;
      }
    }
    const prefix = season !== undefined && (!groups.length || season !== previousSeason) ? `${season}/` : '';
    const part = item.part && item.parts ? `·T${item.part}/${item.parts}` : '';
    groups.push(`${prefix}${start}${end === start ? '' : `–${end}`}${part}`);
    previousSeason = season;
  }
  return groups.join(',') || undefined;
}

function programmeMetadata(input: ScheduleEntry | readonly ScheduleEntry[], media: ReadonlyMap<string, MediaItem>, featured = false): string {
  const entries = 'id' in input ? [input] : input;
  const number = guideEpisodeNumbers(entries, media);
  const languages = [...new Set(entries.flatMap(entry => entry.subtitleLanguages).filter(Boolean))].map(language => language.toUpperCase()).join(', ');
  const partial = Boolean(languages) && entries.some(entry => !entry.subtitleLanguages.length);
  const wrap = Boolean(number && number.length > 18);
  const label = number ? wrap ? html(number).replaceAll(',', ',<wbr>') : html(number) : '';
  const markers = `${label ? `<small class="episode">(${label})</small>` : ''}${languages ? ` <span class="subtitles" role="img" aria-label="Untertitel${partial ? ' teilweise' : ''}: ${html(languages)}">UT${partial ? '*' : ''}</span>` : ''}${featured ? ' <b class="star">★</b>' : ''}`;
  return markers ? ` <span class="programme-meta${wrap ? ' wrap' : ''}">${markers}</span>` : '';
}

function listing(entries: ScheduleEntry[], day: GuideDay, config: AppConfig, media: ReadonlyMap<string, MediaItem>): string {
  const entry = entries[0]!;
  const local = DateTime.fromMillis(entry.startsAtMs, { zone: config.channel.timezone });
  const ongoing = entry.startsAtMs < day.startsAtMs;
  const afterMidnight = local.toISODate() !== day.date && !ongoing;
  const title = shortTitles[entry.showId] ?? entry.showTitle;
  const featured = entries.some(member => member.id === day.feature?.id);
  return `<li class="programme${featured ? ' featured' : ''}" data-event="${html(entry.id)}" data-events="${html(JSON.stringify(entries.map(member => member.id)))}"><time>${ongoing ? '↳' : local.toFormat('HH.mm')}${afterMidnight ? '<sup>+</sup>' : ''}</time><span>${html(title)}${programmeMetadata(entries, media, featured)}</span></li>`;
}

export function weeklyGuideHtml(days: GuideDay[], config: AppConfig, pictures: Map<string, string>, media: MediaItem[] = []): string {
  const root = config.projectRoot;
  const descriptions = new Map(media.map(item => [item.showId, item.showDescription]));
  const catalogue = new Map(media.map(item => [item.id, item]));
  const date = (value: string) => DateTime.fromISO(value, { zone: config.channel.timezone }).setLocale('de');
  const first = date(days[0]!.date), last = date(days[6]!.date);
  const range = `${first.toFormat('d. MMMM')} – ${last.toFormat('d. MMMM yyyy')}`;
  const hasNight = days.some(day => day.handover || day.night.length);
  const font = (file: string) => dataUri(path.join(root, file), 'font/ttf');
  const columns = days.map((day, i) => {
    const feature = day.feature;
    const picture = feature && pictures.get(feature.id);
    const description = feature ? guideDescription(featureDescriptions[feature.showId] ?? descriptions.get(feature.showId) ?? '') : '';
    const nightHours = day.handover ? `ab ${day.handover} Uhr` : 'Am Abend';
    return `<article class="day" style="--day:${colors[i]}">
      <header class="day-heading"><h2>${weekdays[i]}</h2><span>${date(day.date).toFormat('dd. MMMM')}</span></header>
      <div class="kids-label"><b>LKP</b><span>Für kleine Entdecker</span></div>
      <div class="kids-list fit-list"><ol>${groupGuideEntries(day.kids).map(group => listing(group, day, config, catalogue)).join('') || '<li class="empty">Noch kein Programm veröffentlicht.</li>'}</ol></div>
      <section class="feature"><div class="feature-label">★ UNSER TAGESTIPP ${feature ? `<time>${DateTime.fromMillis(feature.startsAtMs, { zone: config.channel.timezone }).toFormat('HH.mm')}</time>` : ''}</div>
        ${picture ? `<img src="${picture}" alt="${html(feature!.showTitle)}">` : '<div class="no-picture">Ein Tag voller<br>Entdeckungen</div>'}
        <div class="feature-copy"><h3>${html(feature?.showTitle ?? 'Dein Tag mit LKP')}${feature ? programmeMetadata(feature, catalogue) : ''}</h3>${description ? `<p>${html(description)}</p>` : ''}</div>
      </section>
      ${hasNight ? `<header class="night-heading"><span class="moon">☾</span><div><b>LUNDENBURG NACHT</b><span>${nightHours}</span></div></header>
      <div class="night-list fit-list"><ol>${groupGuideEntries(day.night).map(group => listing(group, day, config, catalogue)).join('') || '<li class="empty">Noch kein Nachtprogramm veröffentlicht.</li>'}</ol><div class="night-end">${DateTime.fromMillis(day.endsAtMs, { zone: config.channel.timezone }).toFormat('HH.mm')} · Wieder LKP</div></div>` : ''}
    </article>`;
  }).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>LKP · Fernsehwoche ${html(range)}</title>
<meta name="viewport" content="width=1123"><style>
@font-face{font-family:Guide;src:url('${font('assets/branding/fonts/DejaVuSans.ttf')}')}
@font-face{font-family:Listings;src:url('${font('assets/branding/fonts/DejaVuSansCondensed.ttf')}')}
@font-face{font-family:Fredoka;src:url('${font('assets/weather/fonts/Fredoka.ttf')}');font-weight:300 700}
@font-face{font-family:Nacht;src:url('${font('assets/branding/fonts/DejaVuSerif.ttf')}')}
@page{size:A3 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Guide,sans-serif;color:#182e41;background:#ddd;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.sheet{width:297mm;height:420mm;padding:8mm;background:#fff;display:flex;flex-direction:column;margin:auto}
.masthead{height:25mm;flex-shrink:0;background:#07549a;color:white;display:flex;align-items:center;padding:3mm 5mm;gap:4mm;position:relative;border-bottom:1.3mm solid #f4bf24}
.masthead img{width:19mm;height:19mm;object-fit:contain;background:white;border-radius:3mm;padding:1.5mm}.masthead h1{font-family:Fredoka,sans-serif;font-size:29pt;font-weight:600;margin:0;line-height:1.05}.masthead p{font-size:8pt;margin:1.5mm 0 0;letter-spacing:.4pt}.edition{text-align:right;margin-left:auto}.edition b{font-size:19pt;font-weight:500}.edition span{display:block;font-size:8pt;margin-top:1.5mm}
.subhead{height:9mm;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;font-size:8pt;border-bottom:.25mm solid #d2d9df;margin-bottom:2mm}.subhead b{letter-spacing:.5pt}.subhead span{color:#516575}
.week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1.2mm;flex:1;min-height:0;--night-height:105mm}
.day{min-width:0;min-height:0;border:.25mm solid var(--day);display:grid;grid-template-rows:13mm 6mm minmax(0,1fr) 50mm ${hasNight ? '11mm var(--night-height)' : ''};background:#fffbed;overflow:visible}
.day-heading{background:var(--day);padding:2mm 1.4mm;color:#fff}.day-heading h2{font-family:Fredoka,sans-serif;font-size:12pt;margin:0;font-weight:600;line-height:1.1}.day-heading span{font-size:8pt;display:block;margin-top:1mm}
.kids-label{display:flex;align-items:center;gap:1.5mm;padding:0 1.4mm;border-bottom:.25mm solid var(--day);font-size:5.9pt;background:#fff}.kids-label b{font-family:Fredoka,sans-serif;font-size:10pt;color:#07549a}.kids-label span{letter-spacing:-.1pt}
.fit-list{font-family:Listings,sans-serif;min-height:0;padding:1.4mm 1.2mm;font-size:8.4pt;line-height:1.17;overflow:visible}.fit-list ol{list-style:none;padding:0;margin:0}.programme{display:grid;grid-template-columns:8mm minmax(0,1fr);gap:.6mm;padding:.08mm 0;break-inside:avoid;overflow-wrap:anywhere}.programme time{font-weight:bold;font-variant-numeric:tabular-nums;white-space:nowrap;letter-spacing:-.3pt}.programme span{font-weight:600;letter-spacing:-.25pt}.programme-meta{white-space:nowrap}.programme-meta.wrap,.programme-meta.wrap .episode{white-space:normal}.episode{font-family:Listings,sans-serif;font-weight:normal;font-size:.8em;white-space:nowrap;letter-spacing:-.2pt}.subtitles{display:inline-block;font-family:Guide,sans-serif;font-size:.66em;font-weight:bold;line-height:1;letter-spacing:-.1pt;border:.12mm solid currentColor;border-radius:.3mm;padding:.08em .1em;vertical-align:.08em;white-space:nowrap}.programme .subtitles{font-weight:bold}.programme sup{font-size:5pt;vertical-align:super}.programme.featured{background:var(--day);color:#fff;box-shadow:0 0 0 .65mm var(--day)}.programme.featured .star{color:inherit}.star{color:#b3760d;font-size:.85em}.empty{font-size:8pt;font-weight:normal;padding:3mm 1mm;color:#66757d}
.feature{border-top:.6mm solid var(--day);background:white;display:flex;flex-direction:column;min-height:0}.feature-label{background:var(--day);color:white;font-size:6pt;font-weight:bold;letter-spacing:.1pt;height:5mm;padding:1.3mm 1.2mm;white-space:nowrap;display:flex;justify-content:space-between}.feature img{width:100%;height:24mm;object-fit:cover;display:block}.feature-copy{padding:1.4mm 1.5mm}.feature h3{font-family:Fredoka,sans-serif;font-size:10pt;font-weight:600;line-height:1.1;margin:0 0 .8mm}.feature p{font-size:7pt;line-height:1.2;margin:0}.no-picture{height:24mm;background:#edf4f8;color:#07549a;display:flex;align-items:center;justify-content:center;font-family:Fredoka;font-size:13pt}
.night-heading{display:flex;align-items:center;gap:1.5mm;padding:1.4mm 1.5mm;background:${nacht.colors.ink};color:#fff;border-top:1mm solid ${nacht.colors.gold}}.moon{font-family:Nacht;font-size:20pt;line-height:1}.night-heading b{display:block;font-size:5.7pt;letter-spacing:.15pt;font-weight:normal}.night-heading div>span{display:block;font-family:Nacht;font-size:8pt;color:#fff;margin-top:.7mm}.night-list{background:#f1f2f3;font-size:7.5pt;line-height:1.1;color:${nacht.colors.ink};position:relative;padding-bottom:5mm}.night-list .programme{padding:.04mm 0}.night-list .programme span{font-weight:normal}.night-end{position:absolute;bottom:1.3mm;left:1.3mm;right:1.3mm;border-top:.2mm solid #bac3c9;padding-top:1mm;font-size:6pt;color:#4d6373}
.footer{height:7mm;flex-shrink:0;display:flex;align-items:flex-end;justify-content:space-between;font-size:6pt;color:#526675}.footer b{color:#07549a;font-weight:normal}.footer span{max-width:225mm}.footer .page-number{font-family:Fredoka;font-size:13pt;color:#07549a}
@media print{body{background:white}.sheet{margin:0;break-after:avoid}}
</style></head><body><main class="sheet">
<header class="masthead"><img src="${dataUri(path.join(root, 'assets/logo/lkp-logo.svg'), 'image/svg+xml')}" alt="LKP"><div><h1>Deine Fernsehwoche</h1><p>LUNDENBURG KIDS PREMIUM</p></div><div class="edition"><b>${first.toFormat('dd.MM.')} – ${last.toFormat('dd.MM.')}</b><span>${first.year} · Kalenderwoche ${first.weekNumber}</span></div></header>
<div class="subhead"><b>Sieben Tage. Kleine Abenteuer. Große Entdeckungen.</b><span>★ Tagestipp mit Bild · Abends Lundenburg Nacht</span></div>
<section class="week">${columns}</section>
<footer class="footer"><span><b>${html(range)}</b> · Alle Zeiten ${html(config.channel.timezone)} · + nach Mitternacht, am Folgetag · ↳ läuft bereits<br>(Staffel/Folge) oder (Folge) · Start des Folgenblocks · <span class="subtitles" role="img" aria-label="Untertitel">UT</span> Untertitel, * teilweise · Sendetage ${DateTime.fromMillis(days[0]!.startsAtMs, { zone: config.channel.timezone }).toFormat('HH.mm')}–${DateTime.fromMillis(days[0]!.endsAtMs, { zone: config.channel.timezone }).toFormat('HH.mm')} Uhr · Änderungen vorbehalten</span><span>A3 · 100 % drucken</span><b class="page-number">LKP / ${first.weekNumber}</b></footer>
</main></body></html>`;
}

async function featurePicture(entry: ScheduleEntry, outputDir: string, options: GuideOptions): Promise<string> {
  if (options.artwork) {
    // Show IDs are catalogue data, never paths supplied to the filesystem.
    if (/^[a-zA-Z0-9_-]+$/.test(entry.showId)) {
      for (const extension of ['jpg', 'jpeg', 'png']) {
        const file = path.resolve(options.artwork, `${entry.showId}.${extension}`);
        if (fs.existsSync(file)) return dataUri(file, extension === 'png' ? 'image/png' : 'image/jpeg');
      }
    }
  }
  const segment = entry.playoutPlan?.segments.find(s => s.type === 'content');
  const source = segment?.mediaPath ?? entry.mediaPath;
  const stat = fs.statSync(source);
  const from = segment && 'fromMs' in segment ? segment.fromMs : 0;
  const duration = segment?.durationMs ?? entry.durationMs;
  const seek = (from + Math.min(90_000, duration * .3)) / 1000;
  const file = path.join(outputDir, `${stableId(source, stat.size, stat.mtimeMs, seek)}.jpg`);
  if (!fs.existsSync(file)) {
    const temporary = `${file}.partial.jpg`;
    try {
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-ss', String(seek), '-i', source,
        '-an', '-frames:v', '1', '-vf', 'thumbnail=40,scale=720:450:force_original_aspect_ratio=increase,crop=720:450,setsar=1',
        '-threads', '1', '-q:v', '2', '-y', temporary], { timeout: 60_000, maxBuffer: 1024 * 1024 });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  return dataUri(file, 'image/jpeg');
}

export async function exportWeeklyGuide(output: string, entries: ScheduleEntry[], config: AppConfig, options: GuideOptions = {}): Promise<{
  pdf: string; html: string; preview: string; warnings: string[];
}> {
  const days = buildWeeklyGuide(entries, config, options.week);
  if (!days.some(day => day.kids.length || day.night.length)) throw new Error('No published programmes in this guide week');
  const target = path.resolve(output);
  if (path.extname(target).toLowerCase() !== '.pdf') throw new Error('Weekly guide output must end in .pdf');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const cache = path.join(config.storage.runtimeDirectory, 'weekly-guide', 'pictures');
  fs.mkdirSync(cache, { recursive: true });
  const pictures = new Map<string, string>();
  const warnings: string[] = [];
  // Decode one source at a time to keep the production Pi comfortable.
  for (const day of days) {
    if (!day.kids.length) warnings.push(`No LKP listings for ${day.date}`);
    if (day.handover && !day.night.length) warnings.push(`No LN listings for ${day.date}`);
    if (day.feature) {
      try { pictures.set(day.feature.id, await featurePicture(day.feature, cache, options)); }
      catch { warnings.push(`No picture available for ${day.feature.showTitle} on ${day.date}; using a title card`); }
    }
  }
  const markup = weeklyGuideHtml(days, config, pictures, options.media);
  const htmlFile = target.replace(/\.pdf$/i, '.html');
  const preview = target.replace(/\.pdf$/i, '.png');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lkp-guide-'));
  const input = path.join(work, 'guide.html');
  fs.writeFileSync(input, markup);
  const browserExecutable = options.browser ?? process.env.LKP_GUIDE_BROWSER ?? [
    path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell'),
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ].find(file => fs.existsSync(file));
  if (!browserExecutable) {
    fs.rmSync(work, { recursive: true, force: true });
    throw new Error('Chromium is required for PDF export. Set LKP_GUIDE_BROWSER or pass --browser.');
  }
  let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
  try {
    browser = await openBrowser('chrome', { browserExecutable, logLevel: 'error',
      chromeMode: /headless[_-]shell/.test(browserExecutable) ? 'headless-shell' : 'chrome-for-testing' });
    const page = await browser.newPage({ context: () => null, logLevel: 'error', indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => {} });
    await page.setViewport({ width: 1123, height: 1588, deviceScaleFactor: 2 });
    await page.goto({ url: pathToFileURL(input).href, timeout: 30_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(image => image.decode()));
    });
    // Fit each section as a group. Never truncate rows or hide an overflow.
    // A string keeps TS runners' function-name helpers out of the browser realm.
    const fit = await page.evaluate(`(() => {
      const all = selector => Array.from(document.querySelectorAll(selector));
      const lists = all('.fit-list');
      const fitGroup = (selector, initial, minimum) => {
        const group = all(selector);
        let size = initial;
        const overflow = () => group.some(el => {
          const content = el.querySelector('ol');
          const style = getComputedStyle(el);
          return content.getBoundingClientRect().height > el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) + .5 ||
            content.scrollWidth > content.clientWidth + 1;
        });
        for (; size >= minimum; size = Math.round((size - .1) * 10) / 10) {
          group.forEach(el => { el.style.fontSize = size + 'pt'; });
          if (!overflow()) return size;
        }
        return null;
      };
      const kids = fitGroup('.kids-list', 8.4, 7.2);
      const night = fitGroup('.night-list', 7.5, 6.8);
      const featuresOverflow = all('.feature').some(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
      return { kids, night, featuresOverflow, lists: lists.length };
    })()`) as { kids: number | null; night: number | null; featuresOverflow: boolean; lists: number };
    if (!fit.kids || !fit.night || fit.featuresOverflow) throw new Error(`This week is too dense for a legible one-page guide (${JSON.stringify(fit)}); no PDF was replaced`);
    const pdf = await page._client().send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true,
      paperWidth: 297 / 25.4, paperHeight: 420 / 25.4, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
    // Chromium on the Pi needs a repaint after returning from print layout.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const screenshot = await page._client().send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(work, 'guide.pdf'), Buffer.from(pdf.value.data, 'base64'));
    fs.writeFileSync(path.join(work, 'guide.png'), Buffer.from(screenshot.value.data, 'base64'));
    // Keep the HTML preview identical to the fitted PDF, including chosen sizes.
    const fittedHtml = await page.evaluate(() => '<!doctype html>' + document.documentElement.outerHTML);
    fs.writeFileSync(htmlFile, fittedHtml);
    fs.copyFileSync(path.join(work, 'guide.png'), preview);
    fs.copyFileSync(path.join(work, 'guide.pdf'), `${target}.partial`);
    fs.renameSync(`${target}.partial`, target);
    return { pdf: target, html: htmlFile, preview, warnings };
  } finally {
    await browser?.close({ silent: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
}
