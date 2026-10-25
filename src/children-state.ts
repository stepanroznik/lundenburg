import type { MediaItem, ScheduleEntry } from './types.js';
import type { ChildrenPolicy } from './children-policy.js';

/** One operation owns one context: no global caches or catalogue mutations. */
export function childrenState() {
  return {
    events:new Map<string,ScheduleEntry>(), fillerLastUse:new Map<string,number>(),
    useCounts:new Map<string,number>(), lastUses:new Map<string,number>(),
    totalAirtime:new Map<number,number>(), showAirtime:new Map<string,number>(), languageAirtime:new Map<string,number>(),
    dailyUses:new Map<string,number>(), adUses:new Map<string,number>(), dailyAdUses:new Map<string,number>(),
    originals:new Map<string,ScheduleEntry>(), weeks:new Map<number,number>(),
    policies:new Map<string,ChildrenPolicy>(), paths:new Map<string,boolean>(),
    parts:new Map<string,Array<{media:MediaItem;fromMs:number;toMs:number;part?:number;parts?:number}>>(),
    seasonal:new Map<string,boolean>(), lastAdEnd:0, adRunMs:0,
  };
}
export type ChildrenState=ReturnType<typeof childrenState>;
