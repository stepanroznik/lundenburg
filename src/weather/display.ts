import { DateTime } from 'luxon';
import type { Period } from './model.js';
export const periodTheme: Record<Period, { label: string; color: string; tint: string }> = {
  current: { label: 'JETZT', color: '#004f4f', tint: '#edf6eb' },
  afternoon: { label: 'NACHMITTAG', color: '#bd5203', tint: '#fff4de' },
  evening: { label: 'ABEND', color: '#3e517f', tint: '#eef0fa' },
  tomorrow: { label: 'MORGEN', color: '#007fa9', tint: '#e6f6fd' },
};
export function forecastDate(at: string, period: Period): string {
  const day = DateTime.fromISO(at, { zone: 'Europe/Prague' });
  return (period === 'tomorrow' ? day.plus({ days: 1 }) : day).setLocale('de').toFormat('cccc, d. LLLL');
}
