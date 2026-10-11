import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { brandColors } from './characters/brand.js';
import { isPublicScheduleEntry } from './listing.js';
import { comingUpTextWidth } from './coming-up-font.js';
import { episodeNumberLabel } from './catalogue.js';
import type { AppConfig, ComingUpConfig, ScheduleEntry } from './types.js';

export const defaultComingUpConfig: ComingUpConfig = {
  enabled: true, minProgrammeMinutes: 16, leadSeconds: 60, durationSeconds: 20,
};

export function validateComingUpConfig(c: ComingUpConfig): void {
  if (![c.minProgrammeMinutes, c.leadSeconds, c.durationSeconds].every(Number.isFinite) ||
    c.minProgrammeMinutes <= 0 || c.durationSeconds < 8 || c.leadSeconds < c.durationSeconds) {
    throw new Error('comingUp requires positive programme minutes, durationSeconds >= 8 and leadSeconds >= durationSeconds');
  }
}

export interface ComingUpWindow { startMs: number; endMs: number }

// Use editorial length for eligibility, and the final uninterrupted programme
// run for placement. A bumper may span adjacent content/credits encoders, but
// never an ad or an intermission inside the parent event.
export function comingUpWindow(entry: ScheduleEntry, config: ComingUpConfig): ComingUpWindow | undefined {
  if (!config.enabled || !isPublicScheduleEntry(entry)) return undefined;
  const segments = entry.playoutPlan?.segments;
  const editorialMs = segments ? segments.reduce((sum, s) => sum +
    (s.type === 'content' || s.type === 'credits' ? s.durationMs : 0), 0) : entry.durationMs;
  if (editorialMs <= config.minProgrammeMinutes * 60_000) return undefined;
  let terminalStartMs = 0;
  let elapsedMs = 0;
  for (const segment of segments ?? []) {
    elapsedMs += segment.durationMs;
    if (segment.type !== 'content' && segment.type !== 'credits') terminalStartMs = elapsedMs;
  }
  const durationMs = entry.playoutPlan?.durationMs ?? entry.durationMs;
  const startMs = Math.max(terminalStartMs, durationMs - config.leadSeconds * 1000);
  const endMs = startMs + config.durationSeconds * 1000;
  return endMs <= durationMs ? { startMs, endMs } : undefined;
}

export function comingUpEntries(entry: ScheduleEntry, following: ScheduleEntry[]): ScheduleEntry[] {
  return [entry, ...following.filter(e => e.startsAtMs >= entry.endsAtMs && e.id !== entry.id && isPublicScheduleEntry(e))
    .sort((a, b) => a.startsAtMs - b.startsAtMs).slice(0, 4)];
}

export interface ComingUpCard {
  width: number; height: number; left: number; inset: number; color: string; ink: string;
  lines: { text: string; size: number; top: number }[];
}

export function wrapComingUpTitle(title: string, width: number, size: number, maxLines = 2): string[] {
  const words = title.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  while (words.length && lines.length < maxLines) {
    const word = words[0]!;
    if (comingUpTextWidth([line, word].filter(Boolean).join(' '), size) <= width) {
      line = [line, words.shift()].filter(Boolean).join(' '); continue;
    }
    if (line) { lines.push(line); line = ''; continue; }
    let part = '';
    for (const c of word) {
      if (comingUpTextWidth(part + c + '‐', size) > width) break;
      part += c;
    }
    if (!part) break;
    lines.push(part + '‐'); words[0] = word.slice(part.length);
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.length) {
    const index = Math.max(0, Math.min(lines.length, maxLines) - 1);
    let last = (lines[index] ?? '').replace(/‐$/, '');
    while (last && comingUpTextWidth(last + '…', size) > width) last = last.slice(0, -1);
    lines[index] = last + '…';
  }
  return lines.slice(0, maxLines);
}

export function comingUpCards(entries: ScheduleEntry[], width: number, height: number): ComingUpCard[] {
  const scale = width / 1920;
  const fractions = [.24, .22, .20, .18, .16];
  const labels = ['JETZT', 'GLEICH', 'DANACH', 'SPÄTER', 'ANSCHLIESSEND'];
  let left = 0;
  return entries.slice(0, 5).map((entry, i) => {
    const cardWidth = i === 4 ? width - left : Math.round(width * fractions[i]! / 2) * 2;
    const inset = Math.round((i === 0 ? 72 : 26) * scale);
    const textSpace = cardWidth - inset - (i === 4 ? 54 : 26) * scale;
    let size = Math.round(35 * scale);
    let titles = wrapComingUpTitle(entry.showTitle, textSpace, size);
    for (const smaller of [33, 31, 29]) {
      if (!titles.at(-1)?.endsWith('…')) break;
      size = Math.round(smaller * scale);
      titles = wrapComingUpTitle(entry.showTitle, textSpace, size);
    }
    const episode = episodeNumberLabel(entry);
    const lines = [{ text: labels[i]!, size: Math.round(28 * scale), top: Math.round(22 * scale) },
      ...titles.map((text, n) => ({ text, size, top: Math.round((59 + n * 38) * scale) })),
      ...(episode ? wrapComingUpTitle(episode, textSpace, Math.round(23 * scale)) : []).map((text, n) =>
        ({ text, size: Math.round(23 * scale), top: Math.round((145 + n * 24) * scale) }))];
    const card = { width: cardWidth, height: Math.round(height * .18 / 2) * 2, left, inset,
      color: brandColors[i]!, ink: i === 0 ? '#ffffff' : '#003a3a', lines };
    left += cardWidth; return card;
  });
}

export const comingUpMotion = { enter: .85, unfoldAt: .65, unfoldStagger: .16, unfold: 1.5,
  // Panel 1 is the final moving panel to fold; start departure at that instant.
  foldBeforeEnd: 3, foldStagger: .12, fold: 1.05, exitBeforeEnd: 3 - 3 * .12 - 1.05, exit: .95 };

export function comingUpEase(t: number, at: number, length: number): number {
  return (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, (t - at) / length)))) / 2;
}

export function comingUpCardX(elapsed: number, duration: number, index: number, left: number, firstWidth: number): number {
  const m = comingUpMotion;
  const off = firstWidth + 32;
  const stack = -off * (1 - comingUpEase(elapsed, 0, m.enter)) - off * comingUpEase(elapsed, duration - m.exitBeforeEnd, m.exit);
  const open = comingUpEase(elapsed, m.unfoldAt + (index - 1) * m.unfoldStagger, m.unfold);
  const close = comingUpEase(elapsed, duration - m.foldBeforeEnd + (4 - index) * m.foldStagger, m.fold);
  return stack + left * open * (1 - close);
}

export interface ComingUpOverlay {
  cards: ComingUpCard[]; startSeconds: number; durationSeconds: number; top: number;
}

export function comingUpForPiece(entry: ScheduleEntry, programmeOffsetMs: number, pieceRemainingMs: number,
  following: ScheduleEntry[] | (() => ScheduleEntry[]), config: AppConfig): ComingUpOverlay | undefined {
  const settings = config.comingUp ?? defaultComingUpConfig;
  const window = comingUpWindow(entry, settings);
  if (!window || window.endMs <= programmeOffsetMs || window.startMs >= programmeOffsetMs + pieceRemainingMs) return undefined;
  const entries = comingUpEntries(entry, typeof following === 'function' ? following() : following);
  if (entries.length !== 5) return undefined;
  const cards = comingUpCards(entries, config.video.width, config.video.height);
  return { cards, startSeconds: (window.startMs - programmeOffsetMs) / 1000,
    durationSeconds: settings.durationSeconds, top: config.video.height - cards[0]!.height - Math.round(config.video.height * .05) };
}

function filterPath(file: string): string {
  // Two levels of FFmpeg escaping: option parsing, then filtergraph parsing.
  return file.replace(/([\\':])/g, '\\$1').replace(/([\\'\[\],;])/g, '\\$1');
}

// Finite colour sources draw each card just once in the encoder. Framesync
// holds that frame, moving it only during the 20-second enabled window. No
// browser, asset render, network access, or per-frame text layout is required.
export function comingUpFilter(overlay: ComingUpOverlay, config: AppConfig, inputIndex: number,
  baseLabel: string): { inputs: string[]; filters: string[] } {
  const key = createHash('sha256').update(JSON.stringify(overlay.cards)).digest('hex').slice(0, 24);
  const directory = path.join(config.storage.runtimeDirectory, 'graphics', 'coming-up', key);
  fs.mkdirSync(directory, { recursive: true });
  const font = filterPath(path.join(config.projectRoot, 'assets/weather/fonts/Fredoka.ttf'));
  const inputs: string[] = [], filters: string[] = [];
  const time = `(t-(${overlay.startSeconds}))`, m = comingUpMotion;
  const ease = (at: number, duration: number): string => `((1-cos(PI*clip((${time}-(${at}))/${duration},0,1)))/2)`;
  const off = overlay.cards[0]!.width + 32;
  const stack = `-${off}*(1-${ease(0, m.enter)})-${off}*${ease(overlay.durationSeconds - m.exitBeforeEnd, m.exit)}`;
  overlay.cards.forEach((card, i) => {
    inputs.push('-f', 'lavfi', '-i', `color=c=${card.color}:s=${card.width}x${card.height}:r=${config.video.fps}:d=${1 / config.video.fps}`);
    const text = card.lines.map((line, n) => {
      const file = path.join(directory, `${i}-${n}.txt`);
      if (!fs.existsSync(file)) fs.writeFileSync(file, line.text);
      return `drawtext=fontfile=${font}:textfile=${filterPath(file)}:expansion=none:fontsize=${line.size}:fontcolor=${card.ink}:x=${card.inset}:y=${line.top}`;
    });
    filters.push(`[${inputIndex + i}:v]${text.join(',')}[up${i}]`);
  });
  // Back to front: each smaller panel unwraps from behind its predecessor.
  let previous = baseLabel;
  for (let i = overlay.cards.length - 1; i >= 0; i--) {
    const card = overlay.cards[i]!;
    const x = `${stack}+${card.left}*${ease(m.unfoldAt + (i - 1) * m.unfoldStagger, m.unfold)}*(1-${ease(overlay.durationSeconds - m.foldBeforeEnd + (4 - i) * m.foldStagger, m.fold)})`;
    const label = i === 0 ? 'v' : `withup${i}`;
    filters.push(`[${previous}][up${i}]overlay=x='${x}':y=${overlay.top}:eval=frame:eof_action=repeat:repeatlast=1:format=yuv420:` +
      `enable='gte(t,${overlay.startSeconds})*lt(t,${overlay.startSeconds + overlay.durationSeconds})'[${label}]`);
    previous = label;
  }
  return { inputs, filters };
}
