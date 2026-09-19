import path from 'node:path';
import ExcelJS from 'exceljs';
import { DateTime } from 'luxon';
import type { AppConfig, PlaybackEvent, ScheduleEntry } from './types.js';

const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } };

function localDate(ms: number, zone: string): Date {
  const local = DateTime.fromMillis(ms, { zone });
  return new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.millisecond));
}

function styleSheet(sheet: ExcelJS.Worksheet, widths: number[]): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } };
  sheet.getRow(1).eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = headerFill; });
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

export async function exportWorkbook(
  output: string, schedule: ScheduleEntry[], playback: PlaybackEvent[], config: AppConfig,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Lundenburg Kids Premium';
  workbook.created = new Date();
  const zone = config.channel.timezone;
  const scheduleSheet = workbook.addWorksheet('Schedule');
  scheduleSheet.columns = [
    { header: 'Date', key: 'date' }, { header: 'Start', key: 'start' }, { header: 'End', key: 'end' },
    { header: 'Duration', key: 'duration' }, { header: 'Show', key: 'show' }, { header: 'Season', key: 'season' },
    { header: 'Episode', key: 'episode' }, { header: 'Episode title', key: 'title' }, { header: 'Description', key: 'description' },
    { header: 'Audio language', key: 'audio' }, { header: 'Subtitle languages', key: 'subtitles' },
    { header: 'Media file', key: 'media' }, { header: 'Schedule entry ID', key: 'id' },
  ];
  for (const entry of schedule) scheduleSheet.addRow({
    date: localDate(entry.startsAtMs, zone), start: localDate(entry.startsAtMs, zone), end: localDate(entry.endsAtMs, zone),
    duration: entry.durationMs / 86_400_000, show: entry.showTitle, season: entry.season ?? '', episode: entry.episode ?? '',
    title: entry.episodeTitle, description: entry.description, audio: entry.audioLanguage ?? '',
    subtitles: entry.subtitleLanguages.join(', '), media: entry.mediaPath, id: entry.id,
  });
  scheduleSheet.getColumn(1).numFmt = 'yyyy-mm-dd';
  scheduleSheet.getColumn(2).numFmt = 'hh:mm:ss'; scheduleSheet.getColumn(3).numFmt = 'hh:mm:ss';
  scheduleSheet.getColumn(4).numFmt = '[h]:mm:ss';
  styleSheet(scheduleSheet, [12, 11, 11, 12, 28, 9, 9, 32, 60, 15, 20, 55, 27]);

  const playbackSheet = workbook.addWorksheet('Playback Log');
  playbackSheet.columns = [
    { header: 'Schedule entry ID', key: 'scheduleId' }, { header: 'Planned start', key: 'plannedStart' },
    { header: 'Planned end', key: 'plannedEnd' }, { header: 'Actual start', key: 'actualStart' },
    { header: 'Actual end', key: 'actualEnd' }, { header: 'Initial seek', key: 'seek' },
    { header: 'Cold-start resume', key: 'cold' }, { header: 'Result', key: 'result' }, { header: 'Error', key: 'error' },
  ];
  for (const event of playback) playbackSheet.addRow({
    scheduleId: event.scheduleEntryId, plannedStart: localDate(event.plannedStartMs, zone), plannedEnd: localDate(event.plannedEndMs, zone),
    actualStart: localDate(event.actualStartMs, zone), actualEnd: event.actualEndMs ? localDate(event.actualEndMs, zone) : '',
    seek: event.initialSeekMs / 86_400_000, cold: event.coldStartResume ? 'yes' : 'no', result: event.status, error: event.error ?? '',
  });
  [2, 3, 4, 5].forEach((column) => { playbackSheet.getColumn(column).numFmt = 'yyyy-mm-dd hh:mm:ss.000'; });
  playbackSheet.getColumn(6).numFmt = '[h]:mm:ss.000';
  styleSheet(playbackSheet, [27, 23, 23, 23, 23, 17, 19, 14, 50]);

  const comparisonSheet = workbook.addWorksheet('Comparison');
  comparisonSheet.columns = [
    { header: 'Schedule entry ID', key: 'id' }, { header: 'Show / episode', key: 'title' },
    { header: 'Planned start', key: 'plannedStart' }, { header: 'Actual start', key: 'actualStart' },
    { header: 'Start delta (s)', key: 'startDelta' }, { header: 'Planned end', key: 'plannedEnd' },
    { header: 'Actual end', key: 'actualEnd' }, { header: 'End delta (s)', key: 'endDelta' }, { header: 'Result', key: 'result' },
  ];
  const scheduleById = new Map(schedule.map((entry) => [entry.id, entry]));
  for (const event of playback) {
    const planned = scheduleById.get(event.scheduleEntryId);
    comparisonSheet.addRow({
      id: event.scheduleEntryId, title: planned ? `${planned.showTitle}: ${planned.episodeTitle}` : '',
      plannedStart: localDate(event.plannedStartMs, zone), actualStart: localDate(event.actualStartMs, zone),
      startDelta: (event.actualStartMs - event.plannedStartMs) / 1000, plannedEnd: localDate(event.plannedEndMs, zone),
      actualEnd: event.actualEndMs ? localDate(event.actualEndMs, zone) : '',
      endDelta: event.actualEndMs ? (event.actualEndMs - event.plannedEndMs) / 1000 : '', result: event.status,
    });
  }
  [3, 4, 6, 7].forEach((column) => { comparisonSheet.getColumn(column).numFmt = 'yyyy-mm-dd hh:mm:ss.000'; });
  styleSheet(comparisonSheet, [27, 46, 23, 23, 18, 23, 23, 16, 14]);
  await workbook.xlsx.writeFile(path.resolve(output));
}
