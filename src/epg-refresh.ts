import fs from 'node:fs';
import path from 'node:path';
import type { LkpDatabase } from './database.js';
import type { AppConfig } from './types.js';
import { generateEpgXml } from './epg.js';

// A running older playout process retains its loaded generator. Repair its
// publications before eitinject's stable-file poll, without restarting video/RF.
export function watchEpg(db: LkpDatabase, config: AppConfig, offsetMs = 0): () => void {
  const directory = path.dirname(config.epg.output);
  fs.mkdirSync(directory, { recursive: true });
  let pending: NodeJS.Timeout | undefined;
  const refresh = () => {
    const at = Date.now() - offsetMs;
    const entries = db.listSchedule(at - 86_400_000, at + config.schedule.epgDays * 86_400_000)
      .map(entry => ({ ...entry, startsAtMs: entry.startsAtMs + offsetMs, endsAtMs: entry.endsAtMs + offsetMs }));
    const output = generateEpgXml(entries, config);
    if (fs.existsSync(config.epg.output) && fs.readFileSync(config.epg.output, 'utf8') === output) return;
    const temporary = `${config.epg.output}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, output);
    fs.renameSync(temporary, config.epg.output);
  };
  const watcher = fs.watch(directory, (_event, file) => {
    if (file?.toString() !== path.basename(config.epg.output)) return;
    clearTimeout(pending);
    pending = setTimeout(refresh, 25);
  });
  const interval = setInterval(refresh, config.epg.refreshSeconds * 1000);
  refresh();
  return () => { watcher.close(); clearTimeout(pending); clearInterval(interval); };
}
