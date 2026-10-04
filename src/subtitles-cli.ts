import { Command } from 'commander';
import { loadConfig } from './config.js';
import { LkpDatabase } from './database.js';
import { prepareSubtitle, textSubtitleTracks } from './subtitles.js';
import type { ScheduleEntry } from './types.js';

const program = new Command().name('lkp-subtitles');
program.command('prepare').option('--id <media-id>', 'prepare one catalogue asset').option('--weather-only', 'prepare published weather tracks first').action(async (options: { id?: string; weatherOnly?: boolean }) => {
  const config = loadConfig(), db = new LkpDatabase(config.storage.database);
  let prepared = 0, failed = 0;
  try {
    const upcoming = db.listSchedule(Date.now() - 86400000, Date.now() + 7 * 86400000);
    const items = options.weatherOnly ? [] : db.listMedia().filter(item => !options.id || item.id === options.id);
    if (options.id && !items.length) throw new Error(`Unknown media item: ${options.id}`);
    const rank = new Map(upcoming.map(e => [e.mediaId, e.startsAtMs] as const).reverse());
    items.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    const work = [
      ...(!options.id ? upcoming.filter(e => e.showId === 'lkp-weather').map(entry => ({ entry, media: undefined, duration: entry.durationMs })) : []),
      ...items.map(media => ({ media, duration: media.durationMs, entry: {
        id: media.id, mediaId: media.id, sequence: 0, showId: media.showId, showTitle: media.showTitle,
        episodeTitle: media.episodeTitle, description: media.description, startsAtMs: 0, endsAtMs: media.durationMs,
        durationMs: media.durationMs, mediaPath: media.mediaPath, subtitleLanguages: media.subtitles.map(t => t.language),
      } satisfies ScheduleEntry })),
    ];
    for (const { entry, media, duration } of work) for (const track of textSubtitleTracks(entry, media)) {
      try {
        const output = await prepareSubtitle(entry, track, config, duration);
        console.log(JSON.stringify({ mediaId: entry.mediaId, language: track.language, output, status: 'ready' }));
        prepared++;
      } catch (error) {
        failed++;
        console.error(JSON.stringify({ mediaId: entry.mediaId, language: track.language, status: 'failed', error: error instanceof Error ? error.message : String(error) }));
      }
    }
    console.log(JSON.stringify({ prepared, failed, status: failed ? 'partial' : 'complete' }));
    if (failed) process.exitCode = 1;
  } finally { db.close(); }
});
program.parseAsync().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
