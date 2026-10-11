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

export function generateEpgXml(entries: ScheduleEntry[], config: AppConfig): string {
  const body = publicSchedule(entries).map((entry) => {
    // DVB has whole-second precision. Quantize both ends with the same rule,
    // rather than rounding a duration independently and creating tiny holes.
    const startsAtMs = Math.floor(entry.startsAtMs / 1000) * 1000;
    const endsAtMs = Math.floor(entry.endsAtMs / 1000) * 1000;
    const start = DateTime.fromMillis(startsAtMs, { zone: 'utc' }).toFormat('yyyy-LL-dd HH:mm:ss');
    const id = entry.epgEventId ?? (entry.sequence % 65_535) + 1;
    const description = eventDescription(entry);
    const shortText = description.slice(0, 240);
    const extended = description.length > shortText.length
      ? `\n      <extended_event_descriptor language_code="${xml(config.epg.language)}" descriptor_number="0" last_descriptor_number="0">\n        <text>${xml(description)}</text>\n      </extended_event_descriptor>`
      : '';
    return `    <event event_id="${id}" start_time="${start}" duration="${durationClock(endsAtMs - startsAtMs)}" running_status="undefined">\n      <short_event_descriptor language_code="${xml(config.epg.language)}">\n        <event_name>${xml(eventName(entry))}</event_name>\n        <text>${xml(shortText)}</text>\n      </short_event_descriptor>${extended}\n    </event>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tsduck>\n  <EIT service_id="${config.channel.serviceId}" transport_stream_id="${config.channel.transportStreamId}" original_network_id="${config.channel.originalNetworkId}">\n${body}\n  </EIT>\n</tsduck>\n`;
}

export function writeEpgAtomic(entries: ScheduleEntry[], config: AppConfig): void {
  fs.mkdirSync(path.dirname(config.epg.output), { recursive: true });
  const temporary = `${config.epg.output}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, generateEpgXml(entries, config), 'utf8');
  fs.renameSync(temporary, config.epg.output);
}
