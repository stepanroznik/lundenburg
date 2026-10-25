import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { MediaItem } from './types.js';

export type Daypart = 'morning' | 'daytime' | 'afternoon' | 'evening' | 'bedtime';
export interface ChildrenPolicy {
  recommendedAgeMin: number; recommendedAgeMax: number;
  maximumTargetAge?: number;
  schedulingPriority: 'flagship' | 'regular' | 'filler';
  preferredDayparts: Partial<Record<Daypart, number>>;
  preferredSlotDurationMinutes: number;
  targetWeeklyAirtimeMinutes: number;
  energyLevel: 'calm' | 'moderate' | 'high';
  nextDayRerun: boolean;
  excludedDayparts?: Daypart[];
}
export interface ChildrenSlot { time: string; minutes: number; showId: string; rerunOf?: string; olderShowId?: string; weekdays?: number[] }
export interface ChildrenConfig {
  boundaryToleranceSeconds?: number;
  effectiveAtMs?: number;
  enabled: boolean; targetAgeYears: number; ageToleranceYears: number;
  policies: Record<string, ChildrenPolicy>; slots: ChildrenSlot[];
}
export function validateAge(age: number, tolerance: number): void {
  if (!Number.isFinite(age) || age < 0 || age > 18 || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 5) throw new Error('Invalid children target age or tolerance');
}
export function validateChildrenPolicy(value: unknown): ChildrenPolicy {
  const p = value as ChildrenPolicy;
  if (!p || !Number.isFinite(p.recommendedAgeMin) || !Number.isFinite(p.recommendedAgeMax) || p.recommendedAgeMin < 0 || p.recommendedAgeMax > 18 || p.recommendedAgeMax < p.recommendedAgeMin ||
    !['flagship', 'regular', 'filler'].includes(p.schedulingPriority) || !['calm', 'moderate', 'high'].includes(p.energyLevel) || typeof p.nextDayRerun !== 'boolean' ||
    !(p.preferredSlotDurationMinutes > 0) || !(p.targetWeeklyAirtimeMinutes >= 0) || !p.preferredDayparts ||
    Object.entries(p.preferredDayparts).some(([key, weight]) => !dayparts.includes(key as Daypart) || !Number.isFinite(weight) || weight < 0) ||
    (p.maximumTargetAge !== undefined && (!Number.isFinite(p.maximumTargetAge) || p.maximumTargetAge < 0)) ||
    p.excludedDayparts?.some(d => !dayparts.includes(d))) throw new Error('Invalid children editorial policy');
  return p;
}
const dayparts: Daypart[] = ['morning', 'daytime', 'afternoon', 'evening', 'bedtime'];
export function loadChildrenConfig(root: string): ChildrenConfig | undefined {
  const file = path.join(root, 'config/children.yaml');
  if (!fs.existsSync(file)) return undefined;
  const c = parse(fs.readFileSync(file, 'utf8')) as ChildrenConfig;
  validateAge(c.targetAgeYears, c.ageToleranceYears);
  if (c.boundaryToleranceSeconds !== undefined && (!Number.isFinite(c.boundaryToleranceSeconds) || c.boundaryToleranceSeconds<0 || c.boundaryToleranceSeconds>30)) throw new Error('Invalid children boundary tolerance');
  if (typeof c.enabled !== 'boolean' || !c.policies || !Array.isArray(c.slots)) throw new Error('Invalid children configuration');
  Object.values(c.policies).forEach(validateChildrenPolicy);
  const slots = [...c.slots].sort((a,b) => a.time.localeCompare(b.time));
  let end = 0;
  for (const s of slots) {
    const start = Number(s.time.slice(0,2))*60 + Number(s.time.slice(3));
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.time) || !Number.isFinite(s.minutes) || s.minutes <= 0 || start < end || start+s.minutes > 1440 || !s.showId || s.weekdays?.some(d=>!Number.isInteger(d) || d<1 || d>7) ||
      (s.rerunOf !== undefined && !c.slots.some(o => !o.rerunOf && o.time === s.rerunOf))) throw new Error('Invalid or overlapping children clock slots');
    end = start+s.minutes;
  }
  return c;
}
/** Unknown content is never inferred to be preschool merely because it was imported. */
export function childrenPolicy(item: MediaItem, c: ChildrenConfig): ChildrenPolicy | undefined {
  const explicit = item.technical.childrenPolicy as ChildrenPolicy | undefined;
  if (explicit) return validateChildrenPolicy(explicit);
  if (c.policies[item.showId]) return c.policies[item.showId];
  const age = (item.technical.acquisition as { classification?: { ageSuitability?: string } } | undefined)?.classification?.ageSuitability;
  const range = ({ toddler: [1,4], preschool: [3,6], 'older-children': [7,12] } as Record<string, number[]>)[age ?? ''];
  return range ? { recommendedAgeMin: range[0]!, recommendedAgeMax: range[1]!, schedulingPriority: 'regular', preferredDayparts: { daytime: 1 }, preferredSlotDurationMinutes: 30, targetWeeklyAirtimeMinutes: 60, energyLevel: 'moderate', nextDayRerun: false } : undefined;
}
export function ageEligible(item: MediaItem, c?: ChildrenConfig): boolean {
  if (!c?.enabled) return true;
  const p = childrenPolicy(item,c);
  return Boolean(p && c.targetAgeYears >= Math.max(0,p.recommendedAgeMin-c.ageToleranceYears) && c.targetAgeYears <= p.recommendedAgeMax+c.ageToleranceYears &&
    (p.maximumTargetAge === undefined || c.targetAgeYears <= p.maximumTargetAge));
}
export function daypart(hour: number): Daypart { return hour < 10 ? 'morning' : hour < 15 ? 'daytime' : hour < 18 ? 'afternoon' : hour < 18.5 ? 'evening' : 'bedtime'; }
