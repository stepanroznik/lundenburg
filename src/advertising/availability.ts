import { availableDuring } from '../programming/availability.js';
/** Seasonal spots share the station's annual Prague availability rules. */
export function adAvailableAt(ad: { tags?: readonly string[]; durationMs: number }, atMs: number): boolean {
  return (ad.tags ?? []).every(tag => tag !== 'christmas' && tag !== 'summer' || availableDuring(tag, atMs, ad.durationMs));
}
