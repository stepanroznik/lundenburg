import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Only retire the four original static cards after the replacement is published.
const root = '/mnt/lkp-media/LKP/.generated/lkp-ads/bumpers';
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'published.json'), 'utf8'));
const active = new Set(manifest.bumpers.map(bumper => bumper.mediaPath));
if (active.size !== 4 || [...active].some(file => !fs.existsSync(file))) {
  throw new Error('Four published replacement masters are required before cleanup');
}
const db = new Database('data/lkp.sqlite', { readonly: true });
try {
  const references = db.prepare('SELECT count(*) AS count FROM schedule_entries WHERE ends_at_ms > ? AND (media_path = ? OR instr(playout_plan_json, ?) > 0)');
  for (const id of ['knurpsi', 'sisi', 'schalinka', 'haluschka']) {
    const file = path.join(root, `${id}.mp4`);
    if (!fs.existsSync(file) || active.has(file)) continue;
    if (references.get(Date.now(), file, file).count) {
      console.log(`Retained static bumper still referenced by current/future playback: ${id}`);
      continue;
    }
    fs.unlinkSync(file);
    console.log(`Removed superseded static bumper: ${id}`);
  }
} finally {
  db.close();
}
