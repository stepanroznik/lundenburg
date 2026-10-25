import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import type { AppConfig, ScheduleEntry } from './types.js';
import { durationClock } from './util.js';
import { publicSchedule } from './listing.js';
import { episodeNumberLabel } from './catalogue.js';

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function eventName(entry: ScheduleEntry): string {
  return entry.episodeTitle && entry.episodeTitle !== entry.showTitle ? `${entry.showTitle}: ${entry.episodeTitle}` : entry.showTitle;
}

function eventDescription(entry: ScheduleEntry): string {
  const label = episodeNumberLabel(entry);
  const number = label ? `${label}. ` : '';
  return `${number}${entry.description}`.trim();
}

// DVB descriptor lengths count encoded bytes, including both strings and their
// charset selectors. Reserve up to three selector bytes per string; UTF-8 is a
// conservative bound for the default DVB encoding used by the live injector.
function prefixBytes(value: string, limit: number): string {
  let result = '', bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > limit) break;
    result += character; bytes += size;
  }
  return result;
}

function descriptionParts(value: string): string[] {
  const parts: string[] = [];
  let remaining = value;
  // Leave room for the short descriptor and the EIT section header, even for
  // unusually large imported descriptions. Ordinary descriptions remain whole.
  while (remaining && parts.length < 14) {
    const part = prefixBytes(remaining, 246);
    parts.push(part); remaining = remaining.slice(part.length);
  }
  return parts;
}

export function generateEpgXml(entries: ScheduleEntry[], config: AppConfig): string {
  const body = publicSchedule(entries).map((entry) => {
    // DVB has whole-second precision. Quantize both ends with the same rule,
    // rather than rounding a duration independently and creating tiny holes.
    const startsAtMs = Math.floor(entry.startsAtMs / 1000) * 1000;
    const endsAtMs = Math.floor(entry.endsAtMs / 1000) * 1000;
    const start = DateTime.fromMillis(startsAtMs, { zone: 'utc' }).toFormat('yyyy-LL-dd HH:mm:ss');
    const id = entry.epgEventId ?? (entry.sequence % 65_535) + 1;
    const description = eventDescription(entry);
    const name = prefixBytes(eventName(entry), 200);
    const shortText = prefixBytes(description, 244 - Buffer.byteLength(name, 'utf8'));
    const parts = descriptionParts(description);
    const genre = entry.presentation?.genre;
    const content = genre === undefined ? '' : `\n      <content_descriptor><content content_nibble_level_1="${genre >> 4}" content_nibble_level_2="${genre & 15}" user_byte="0"/></content_descriptor>`;
    const extended = description.length > shortText.length
      ? parts.map((part, index) => `\n      <extended_event_descriptor language_code="${xml(config.epg.language)}" descriptor_number="${index}" last_descriptor_number="${parts.length - 1}">\n        <text>${xml(part)}</text>\n      </extended_event_descriptor>`).join('')
      : '';
    return `    <event event_id="${id}" start_time="${start}" duration="${durationClock(endsAtMs - startsAtMs)}" running_status="undefined">\n      <short_event_descriptor language_code="${xml(config.epg.language)}">\n        <event_name>${xml(name)}</event_name>\n        <text>${xml(shortText)}</text>\n      </short_event_descriptor>${extended}${content}\n    </event>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tsduck>\n  <EIT service_id="${config.channel.serviceId}" transport_stream_id="${config.channel.transportStreamId}" original_network_id="${config.channel.originalNetworkId}">\n${body}\n  </EIT>\n</tsduck>\n`;
}

export function writeEpgAtomic(entries: ScheduleEntry[], config: AppConfig): void {
  fs.mkdirSync(path.dirname(config.epg.output), { recursive: true });
  const temporary = `${config.epg.output}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, generateEpgXml(entries, config), 'utf8');
  fs.renameSync(temporary, config.epg.output);
}
