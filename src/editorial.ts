import { createHash } from 'node:crypto';
import type {
  AdAsset, AdvertisingConfig, Breakpoint, CreditsPolicy, EditorialMarker, MediaItem,
  PlayoutPlan, PlayoutSegment,
} from './types.js';
import type { RotationClip } from './intermissions/rotation.js';
import { seasonAt } from './intermissions/season.js';

export interface BreakSignal {
  atMs: number;
  manual?: boolean;
  known?: boolean;
  strongChapter?: boolean;
  embeddedChapter?: boolean;
  black?: boolean;
  sceneChange?: boolean;
  silence?: boolean;
  dialogueGap?: boolean;
  dialogue?: boolean;
  subtitleCrosses?: boolean;
  continuousAction?: boolean;
}

export interface AdBumper {
  character: 'knurpsi' | 'sisi' | 'schalinka' | 'haluschka';
  mediaPath: string;
  durationMs: number;
}

const characters: AdBumper['character'][] = ['knurpsi', 'sisi', 'schalinka', 'haluschka'];

function unit(seed: string, ...parts: Array<string | number>): number {
  return createHash('sha256').update([seed, ...parts].join('\0')).digest().readUInt32BE(0) / 0x1_0000_0000;
}

export function scoreBreakSignal(signal: BreakSignal): Breakpoint {
  const reasons: string[] = [];
  let score = 0;
  const add = (enabled: boolean | undefined, points: number, reason: string): void => {
    if (enabled) { score += points; reasons.push(reason); }
  };
  add(signal.manual, 100, 'manual override');
  add(signal.known, 50, 'known break marker');
  add(signal.strongChapter, 20, 'strong chapter boundary');
  add(signal.embeddedChapter, 12, 'embedded chapter');
  add(signal.black, 15, 'fade or black interval');
  add(signal.sceneChange, 10, 'major scene transition');
  add(signal.silence, 8, 'silence');
  add(signal.dialogueGap, 5, 'dialogue/subtitle gap');
  add(signal.dialogue, -30, 'active dialogue');
  add(signal.subtitleCrosses, -25, 'subtitle crosses cut');
  add(signal.continuousAction, -15, 'continuous action or music');
  return {
    atMs: signal.atMs,
    score,
    confidence: Math.max(0, Math.min(1, (score + 30) / 100)),
    reason: reasons,
    source: signal.manual ? 'manual' : signal.known ? 'known' : (signal.strongChapter || signal.embeddedChapter) ? 'chapter' : 'local',
    enabled: true,
  };
}

export function desiredBreakCount(editorialDurationMs: number, minimumMinutes = 35): number {
  const minutes = editorialDurationMs / 60_000;
  if (minutes <= minimumMinutes) return 0;
  if (minutes <= 65) return 1;
  if (minutes <= 105) return 2;
  if (minutes <= 145) return 3;
  return Math.max(4, Math.round(minutes / 40));
}

export function chooseBreakpoints(
  candidates: Breakpoint[], editorialDurationMs: number, options: { minimumMinutes?: number; windowMinutes?: number; minimumScore?: number } = {},
): Breakpoint[] {
  const count = desiredBreakCount(editorialDurationMs, options.minimumMinutes);
  if (!count) return [];
  const windowMs = (options.windowMinutes ?? 5) * 60_000;
  const minimumScore = options.minimumScore ?? 12;
  const enabled = candidates.filter((candidate) => candidate.enabled && candidate.atMs > 5 * 60_000 && candidate.atMs < editorialDurationMs - 5 * 60_000);
  const selected: Breakpoint[] = [];
  for (let index = 1; index <= count; index += 1) {
    const target = editorialDurationMs * index / (count + 1);
    const best = enabled
      .filter((candidate) => Math.abs(candidate.atMs - target) <= windowMs && selected.every((prior) => Math.abs(prior.atMs - candidate.atMs) >= 10 * 60_000))
      .map((candidate) => ({ candidate, rank: candidate.score - Math.abs(candidate.atMs - target) / windowMs * 10 }))
      .filter(({ candidate }) => candidate.score >= minimumScore)
      .sort((a, b) => b.rank - a.rank || a.candidate.atMs - b.candidate.atMs)[0]?.candidate;
    if (best) selected.push(best);
  }
  return selected.sort((a, b) => a.atMs - b.atMs);
}

interface SourceRange { type: 'content' | 'credits'; fromMs: number; toMs: number }

export function editorialEnd(markers: EditorialMarker[], durationMs: number): number {
  return markers.filter((marker) => marker.kind === 'credits' && marker.confidence >= .7).sort((a, b) => a.startMs - b.startMs)[0]?.startMs ?? durationMs;
}

export function creditAwareRanges(durationMs: number, markers: EditorialMarker[], policy: CreditsPolicy, keepMs = 15_000): SourceRange[] {
  if (policy === 'full') return [{ type: 'content', fromMs: 0, toMs: durationMs }];
  const credits = markers
    .filter((marker) => marker.kind === 'credits' && marker.confidence >= .7)
    .map((marker) => ({ start: Math.max(0, marker.startMs), end: Math.min(durationMs, marker.endMs ?? durationMs) }))
    .filter((marker) => marker.end > marker.start)
    .sort((a, b) => a.start - b.start);
  if (!credits.length) return [{ type: 'content', fromMs: 0, toMs: durationMs }];
  const ranges: SourceRange[] = [];
  let cursor = 0;
  for (const credit of credits) {
    if (credit.start > cursor) ranges.push({ type: 'content', fromMs: cursor, toMs: credit.start });
    const length = credit.end - credit.start;
    const shown = policy === 'shorten' && length > keepMs * 2 ? keepMs : policy === 'skip' ? 0 : length;
    if (shown > 0) ranges.push({ type: 'credits', fromMs: credit.start, toMs: credit.start + shown });
    cursor = Math.max(cursor, credit.end);
  }
  if (cursor < durationMs) ranges.push({ type: 'content', fromMs: cursor, toMs: durationMs });
  return ranges;
}

function segment(range: SourceRange, mediaPath: string, fromMs = range.fromMs, toMs = range.toMs): PlayoutSegment {
  return { type: range.type, mediaPath, fromMs, toMs, durationMs: toMs - fromMs };
}

export function deterministicCharacter(eventId: string, breakIndex: number, seed: string): AdBumper['character'] {
  return characters[Math.floor(unit(seed, eventId, breakIndex, 'character') * characters.length)]!;
}

export function chooseAds(ads: AdAsset[], eventId: string, breakIndex: number, seed: string, previousAdId?: string, maxSeconds = 60): AdAsset[] {
  let choices = ads.filter((ad) => ad.enabled).sort((a, b) => a.id.localeCompare(b.id));
  if (choices.length > 1 && previousAdId) choices = choices.filter((ad) => ad.id !== previousAdId);
  if (!choices.length) return [];
  const first = choices[Math.floor(unit(seed, eventId, breakIndex, 'ad-0') * choices.length)]!;
  const selected = [first];
  const secondChoices = choices.filter((ad) => ad.id !== first.id && first.durationMs + ad.durationMs <= maxSeconds * 1000);
  if (first.durationMs < 30_000 && secondChoices.length) selected.push(secondChoices[Math.floor(unit(seed, eventId, breakIndex, 'ad-1') * secondChoices.length)]!);
  return selected;
}

function chooseIntermission(clips: RotationClip[], eventId: string, breakIndex: number, seed: string, atMs: number): RotationClip | undefined {
  const eligible = clips.filter((clip) => !clip.season || clip.season === seasonAt(new Date(atMs))).sort((a, b) => a.id.localeCompare(b.id));
  if (!eligible.length) return undefined;
  return eligible[Math.floor(unit(seed, eventId, breakIndex, 'intermission') * eligible.length)];
}

export function buildPlayoutPlan(input: {
  eventId: string; eventStartMs: number; media: MediaItem; advertising?: AdvertisingConfig; ads?: AdAsset[];
  bumpers?: AdBumper[]; intermissions?: RotationClip[]; seed: string; programmeOrdinal: number;
}): PlayoutPlan {
  const { eventId, eventStartMs, media, advertising, seed, programmeOrdinal } = input;
  const markers = media.editorialMarkers ?? [];
  const policy = media.creditsPolicy ?? 'shorten';
  const ranges = creditAwareRanges(media.durationMs, markers, policy);
  const normalEnd = media.effectiveEditorialDurationMs ?? editorialEnd(markers, media.durationMs);
  const eligible = Boolean(advertising?.enabled) && programmeOrdinal % (advertising?.programmeInterval ?? 2) === 1;
  const breaks = eligible ? chooseBreakpoints(media.breakpoints ?? [], normalEnd, {
    ...(advertising ? { minimumMinutes: advertising.minEditorialMinutes } : {}),
    ...(advertising ? { windowMinutes: advertising.searchWindowMinutes } : {}),
    ...(advertising ? { minimumScore: 0 } : {}),
  }) : [];
  const warnings: string[] = [];
  if (eligible && desiredBreakCount(normalEnd, advertising?.minEditorialMinutes) > 0 && !breaks.length) warnings.push('No acceptable editorial breakpoint; advertisements omitted');
  const result: PlayoutSegment[] = [];
  let previousAdId: string | undefined;
  let breakIndex = 0;
  for (const range of ranges) {
    const inside = breaks.filter((point) => point.atMs > range.fromMs && point.atMs < range.toMs);
    let cursor = range.fromMs;
    for (const point of inside) {
      result.push(segment(range, media.mediaPath, cursor, point.atMs));
      const ads = chooseAds(input.ads ?? [], eventId, breakIndex, seed, previousAdId, advertising?.targetSeconds.max);
      const character = deterministicCharacter(eventId, breakIndex, seed);
      const bumper = input.bumpers?.find((candidate) => candidate.character === character);
      if (ads.length && bumper) {
        result.push({ type: 'ad-ident', mediaPath: bumper.mediaPath, durationMs: bumper.durationMs, character });
        for (const ad of ads) result.push({ type: 'ad', mediaPath: ad.mediaPath, durationMs: ad.durationMs, adId: ad.id });
        previousAdId = ads.at(-1)?.id;
        const intermission = chooseIntermission(input.intermissions ?? [], eventId, breakIndex, seed, eventStartMs + point.atMs);
        if (intermission) result.push({ type: 'intermission', mediaPath: intermission.mediaPath, durationMs: intermission.durationMs, intermissionId: intermission.id });
      } else if (ads.length) warnings.push(`Break ${breakIndex + 1}: WERBUNG bumper unavailable; advertisements omitted`);
      cursor = point.atMs;
      breakIndex += 1;
    }
    if (cursor < range.toMs) result.push(segment(range, media.mediaPath, cursor));
  }
  const segments = result.filter((part) => part.durationMs > 0);
  return { version: 1, programmeEventId: eventId, sourceDurationMs: media.durationMs, durationMs: segments.reduce((sum, part) => sum + part.durationMs, 0), segments, warnings };
}

export function locatePlayoutPosition(plan: PlayoutPlan, elapsedMs: number): { segmentIndex: number; offsetMs: number; segment: PlayoutSegment } | undefined {
  let cursor = 0;
  for (let index = 0; index < plan.segments.length; index += 1) {
    const segment = plan.segments[index]!;
    if (elapsedMs < cursor + segment.durationMs) return { segmentIndex: index, offsetMs: Math.max(0, elapsedMs - cursor), segment };
    cursor += segment.durationMs;
  }
  return undefined;
}
