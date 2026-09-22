#!/usr/bin/env node
import path from 'node:path';
import { Command, Option } from 'commander';
import { DateTime } from 'luxon';
import { loadConfig } from './config.js';
import { LkpDatabase } from './database.js';
import { reconcileIntermissions } from './intermissions/rotation.js';
import { runDoctor } from './doctor.js';
import { writeEpgAtomic } from './epg.js';
import { exportWorkbook } from './export.js';
import { scanMedia } from './media.js';
import { runBroadcast } from './playout.js';
import { ensureSchedule, validateTimeline } from './schedule.js';
import { durationClock, formatLocal, parseDateTime } from './util.js';

const program = new Command();
program.name('lkp').description('Lundenburg Kids Premium channel control').version('1.0.0');
program.option('-c, --config <file>', 'configuration YAML');

function context(): { config: ReturnType<typeof loadConfig>; db: LkpDatabase } {
  const config = loadConfig(program.opts<{ config?: string }>().config);
  return { config, db: new LkpDatabase(config.storage.database) };
}

const media = program.command('media').description('media catalogue operations');
media.command('scan').description('scan and probe the source media library')
  .option('--dry-run', 'probe without updating the database')
  .action(async (options: { dryRun?: boolean }) => {
    const { config, db } = context();
    try {
      const items = await scanMedia(config, (message) => console.error(message));
      if (!options.dryRun) db.replaceMedia(items);
      console.log(`Scanned ${items.length} media item(s) in ${new Set(items.map((i) => i.showId)).size} show(s)${options.dryRun ? ' (dry run)' : ''}.`);
      for (const item of items) console.log(`${item.id}\t${durationClock(item.durationMs)}\t${item.showTitle} — ${item.episodeTitle}\t${item.subtitles.map((s) => s.language).join(',') || '-'}`);
    } finally { db.close(); }
  });

const schedule = program.command('schedule').description('persistent programme schedule operations');
schedule.command('generate').description('create or safely extend the persistent schedule')
  .option('--from <dateTime>', 'initial local date/time (only applies to an empty schedule)')
  .option('--days <days>', 'horizon in days', Number)
  .option('--force', 'delete and deterministically rebuild all schedule entries')
  .action((options: { from?: string; days?: number; force?: boolean }) => {
    const { config, db } = context();
    try {
      const result = ensureSchedule(db, config, {
        ...(options.from ? { fromMs: parseDateTime(options.from, config.channel.timezone) } : {}),
        ...(options.days ? { horizonDays: options.days } : {}), ...(options.force ? { force: true } : {}),
      });
      console.log(`Added ${result.added} entries. Schedule: ${formatLocal(result.firstMs, config.channel.timezone)} → ${formatLocal(result.lastMs, config.channel.timezone)}.`);
    } finally { db.close(); }
  });

schedule.command('intermissions').description('insert the published skit rotation at safe future programme boundaries')
  .action(async () => {
    const {config,db}=context();
    try {
      if(!config.intermissions?.enabled)throw new Error('Intermissions are not enabled in the channel configuration');
      const backup=`${config.storage.database}.before-intermissions-${Date.now()}.sqlite`;
      await db.db.backup(backup);
      const added=reconcileIntermissions(db,config);
      writeEpgAtomic(db.listSchedule(Date.now()-86400000,Date.now()+config.schedule.epgDays*86400000),config);
      console.log(`Inserted ${added} intermissions. Schedule backup: ${backup}`);
    } finally {db.close();}
  });

schedule.command('show').description('show schedule entries')
  .option('--from <dateTime>', 'local start date/time')
  .option('--to <dateTime>', 'local end date/time')
  .option('--at <dateTime>', 'show the entry containing this local date/time')
  .action((options: { from?: string; to?: string; at?: string }) => {
    const { config, db } = context();
    try {
      if (options.at) {
        const at = parseDateTime(options.at, config.channel.timezone);
        const entry = db.currentAt(at);
        if (!entry) throw new Error(`No scheduled programme at ${options.at}`);
        console.log(JSON.stringify({ ...entry, startsAt: formatLocal(entry.startsAtMs, config.channel.timezone), endsAt: formatLocal(entry.endsAtMs, config.channel.timezone), seekMs: at - entry.startsAtMs }, null, 2));
        return;
      }
      const from = options.from ? parseDateTime(options.from, config.channel.timezone) : Date.now();
      const to = options.to ? parseDateTime(options.to, config.channel.timezone, true) : from + 86_400_000;
      const entries = db.listSchedule(from, to);
      for (const entry of entries) console.log(`${formatLocal(entry.startsAtMs, config.channel.timezone)}–${formatLocal(entry.endsAtMs, config.channel.timezone, 'HH:mm:ss')}  ${entry.showTitle} — ${entry.episodeTitle}`);
      const errors = validateTimeline(entries);
      if (errors.length) throw new Error(`Schedule validation failed:\n${errors.join('\n')}`);
      console.log(`${entries.length} entries; no gaps or overlaps within the displayed range.`);
    } finally { db.close(); }
  });

schedule.command('export').description('export planned and actual playout to XLSX')
  .option('--from <date>', 'local start date')
  .option('--to <date>', 'local end date')
  .option('-o, --output <file>', 'workbook path', './runtime/lkp-schedule.xlsx')
  .action(async (options: { from?: string; to?: string; output: string }) => {
    const { config, db } = context();
    try {
      const bounds = db.scheduleBounds();
      if (!bounds) throw new Error('Schedule is empty');
      const from = options.from ? parseDateTime(options.from, config.channel.timezone) : bounds.firstMs;
      const to = options.to ? parseDateTime(options.to, config.channel.timezone, true) : bounds.lastMs;
      const output = path.resolve(options.output);
      await exportWorkbook(output, db.listSchedule(from, to), db.listPlayback(from, to), config);
      console.log(`Wrote ${output}`);
    } finally { db.close(); }
  });

const epg = program.command('epg').description('DVB EPG operations');
epg.command('generate').description('write the rolling TSDuck EIT event database')
  .option('--at <dateTime>', 'local reference time')
  .action((options: { at?: string }) => {
    const { config, db } = context();
    try {
      const at = options.at ? parseDateTime(options.at, config.channel.timezone) : Date.now();
      const entries = db.listSchedule(at - 86_400_000, at + config.schedule.epgDays * 86_400_000);
      writeEpgAtomic(entries, config);
      console.log(`Wrote ${entries.length} EPG events to ${config.epg.output}`);
    } finally { db.close(); }
  });

program.command('doctor').description('check runtime, media, schedule, and broadcast dependencies')
  .option('--rf', 'treat RF-only dependencies as required')
  .action((options: { rf?: boolean }) => {
    const { config, db } = context();
    try {
      const checks = runDoctor(db, config, Boolean(options.rf));
      for (const check of checks) console.log(`${check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN'}  ${check.name}: ${check.detail}`);
      if (checks.some((check) => check.required && !check.ok)) process.exitCode = 1;
    } finally { db.close(); }
  });

const broadcast = program.command('broadcast').description('wall-clock-authoritative playout');
broadcast.command('start').description('start scheduled playout using broadcast.mode from configuration')
  .addOption(new Option('--rf', 'send DVB-T to the HackRF; regulated spectrum').conflicts('dryRun'))
  .addOption(new Option('--mode <mode>', 'override configured output mode').choices(['dvb', 'internet', 'both']))
  .option('--dry-run', 'write a transport stream without transmitting RF')
  .option('--once', 'play only the current scheduled item')
  .option('--output <file>', 'dry-run MPEG-TS output')
  .option('--max-seconds <seconds>', 'stop after a bounded preview', Number)
  .option('--past-hours <hours>', 'play the schedule from this many hours ago', Number)
  .option('--past-minutes <minutes>', 'play the schedule from this many minutes ago', Number)
  .option('--gain <dB>', 'override HackRF TX gain for this run (0-30 dB)', Number)
  .option('--i-understand-rf', 'required acknowledgement for --rf')
  .option('-v, --verbose', 'show child-process diagnostics')
  .action(async (options: { rf?: boolean; mode?: 'dvb'|'internet'|'both'; dryRun?: boolean; once?: boolean; output?: string; maxSeconds?: number; pastHours?: number; pastMinutes?: number; gain?: number; iUnderstandRf?: boolean; verbose?: boolean }) => {
    const { config, db } = context();
    try {
      for (const [flag, value] of [['--past-hours', options.pastHours], ['--past-minutes', options.pastMinutes]] as const) {
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`${flag} must be a non-negative number`);
      }
      const pastOffsetMs = Math.round(((options.pastHours ?? 0) * 60 + (options.pastMinutes ?? 0)) * 60_000);
      if (!Number.isSafeInteger(pastOffsetMs)) throw new Error('The requested past offset is too large');
      if (options.gain !== undefined) {
        if (!Number.isFinite(options.gain) || options.gain < 0 || options.gain > 30) {
          throw new Error('--gain must be a number between 0 and 30 dB');
        }
        config.broadcast.gainDb = options.gain;
      }
      await runBroadcast(db, config, {
        dryRun: Boolean(options.dryRun),
        ...((options.rf || options.mode) ? { mode: options.rf ? 'dvb' as const : options.mode! } : {}),
        once: Boolean(options.once), ...(options.output ? { output: options.output } : {}),
        ...(options.maxSeconds ? { maxSeconds: options.maxSeconds } : {}),
        ...(pastOffsetMs ? { pastOffsetMs } : {}),
        rfAcknowledged: Boolean(options.iUnderstandRf || process.env.LKP_RF_ACKNOWLEDGED === 'YES'), verbose: Boolean(options.verbose),
      });
    } finally { db.close(); }
  });

program.showHelpAfterError();
program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
