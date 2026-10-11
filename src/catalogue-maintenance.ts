import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import type { LkpDatabase } from './database.js';
import { normalizeCatalogue } from './catalogue.js';

export function catalogueChanges(db: LkpDatabase) {
  const items = db.listMedia(false);
  const normalized = normalizeCatalogue(items, items);
  return { items, normalized, changes: normalized.filter((item, index) => JSON.stringify(item) !== JSON.stringify(items[index])) };
}

// Update listing fields only. Event identities, times and playout plans stay intact.
export function writeCatalogue(db: LkpDatabase, backup: string, now = Date.now()) {
  const { normalized, changes } = catalogueChanges(db);
  const sidecars = normalized.filter(item => !item.showId.startsWith('lkp-') && fs.existsSync(item.mediaPath)).map(item => {
    const file = item.mediaPath.slice(0, -path.extname(item.mediaPath).length) + '.yaml';
    const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    const metadata = original ? parse(original) ?? {} : {};
    const updated = { ...metadata, id: item.id, title: item.episodeTitle, description: item.description,
      season: item.season, episode: item.episode, catalogue: item.technical.catalogue };
    delete updated.season; delete updated.episode;
    if (item.season !== undefined) updated.season = item.season;
    if (item.episode !== undefined) updated.episode = item.episode;
    return { file, original, text: stringify(updated) };
  }).filter(sidecar => sidecar.original !== sidecar.text);
  fs.writeFileSync(`${backup}.sidecars.json`, JSON.stringify(sidecars.map(({ file, original }) => ({ file, original }))), { mode: 0o600 });
  // Validate and stage all YAML before the database transaction.
  for (const sidecar of sidecars) fs.writeFileSync(`${sidecar.file}.${process.pid}.tmp`, sidecar.text);
  const update = db.db.prepare('UPDATE schedule_entries SET show_title=?,episode_title=?,description=?,season=?,episode=? WHERE media_id=? AND starts_at_ms>?');
  let scheduleEntries = 0;
  db.db.transaction(() => {
    db.upsertMedia(changes);
    for (const item of normalized) scheduleEntries += update.run(item.showTitle, item.episodeTitle, item.description, item.season ?? null, item.episode ?? null, item.id, now).changes;
  }).immediate();
  for (const sidecar of sidecars) fs.renameSync(`${sidecar.file}.${process.pid}.tmp`, sidecar.file);
  return { changed: changes.length, scheduleEntries, sidecars: sidecars.length };
}
