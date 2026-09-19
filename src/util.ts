import crypto from 'node:crypto';
import { DateTime } from 'luxon';

export function stableId(...parts: Array<string | number>): string {
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

export function formatLocal(epochMs: number, zone: string, format = 'yyyy-LL-dd HH:mm:ss'): string {
  return DateTime.fromMillis(epochMs, { zone }).toFormat(format);
}

export function parseDateTime(value: string, zone: string, endOfDay = false): number {
  const iso = DateTime.fromISO(value, { zone });
  if (!iso.isValid) throw new Error(`Invalid date/time '${value}': ${iso.invalidExplanation ?? iso.invalidReason}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return (endOfDay ? iso.endOf('day') : iso.startOf('day')).toMillis();
  return iso.toMillis();
}

export function durationClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function normalizeLanguage(value?: string): string | undefined {
  if (!value) return undefined;
  const code = value.toLowerCase();
  const aliases: Record<string, string> = { ces: 'cs', cze: 'cs', cs: 'cs', deu: 'de', ger: 'de', de: 'de', eng: 'en', en: 'en' };
  return aliases[code] ?? code.slice(0, 2);
}
