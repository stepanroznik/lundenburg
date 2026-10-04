#!/usr/bin/env bash
# Deploy only the weather/schedule fixes; preserve isolated rendering and caches.
set -euo pipefail
cd "$(dirname "$0")/.."
root=/home/lundenburg/lundenburg
renderer=/home/lundenburg/lkp-weather
test "$PWD" = "$root"
test -d "$renderer/runtime/weather/public/speech"
test "$(findmnt -n -o TARGET --target /mnt/lkp-media/LKP)" = /mnt/lkp-media
backup="$root/runtime/maintenance/weather-repair-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup/renderer/src/weather" "$backup/systemd"
node --input-type=module - "$backup" <<'NODE'
import Database from 'better-sqlite3';
import path from 'node:path';
const db = new Database('/home/lundenburg/lundenburg/data/lkp.sqlite', { readonly: true });
await db.backup(path.join(process.argv[2], 'lkp.sqlite'));
db.close();
NODE
for file in config.ts database.ts epg.ts types.ts listing.ts subtitles.ts; do
  if [ -f "$renderer/src/$file" ]; then cp -a "$renderer/src/$file" "$backup/renderer/src/$file"; fi
  cp "$root/src/$file" "$renderer/src/$file"
done
cp -a "$renderer/src/weather/cli.ts" "$backup/renderer/src/weather/cli.ts"
cp "$root/src/weather/cli.ts" "$renderer/src/weather/cli.ts"
mkdir -p "$backup/renderer/config" "$backup/renderer/scripts"
cp -a "$renderer/config/lkp.yaml" "$backup/renderer/config/lkp.yaml"
cp -a "$renderer/scripts/install-weather-pi.sh" "$backup/renderer/scripts/install-weather-pi.sh"
cp "$root/scripts/install-weather-pi.sh" "$renderer/scripts/install-weather-pi.sh"
bash "$renderer/scripts/install-weather-pi.sh" --configure-only
cp -a /etc/systemd/system/lkp-weather.service "$backup/systemd/lkp-weather.service"
if sudo -n true 2>/dev/null; then
  sudo -n install -m 644 deploy/systemd/lkp-weather.service /etc/systemd/system/lkp-weather.service
  sudo -n systemctl daemon-reload
else
  printf 'Renderer configuration repaired; systemd path pins are ready in deploy/systemd/lkp-weather.service.\n'
fi
LKP_DATABASE="$root/data/lkp.sqlite" LKP_EPG_OUTPUT="$root/runtime/epg.xml" \
  node --import tsx --input-type=module - <<'NODE'
import { LkpDatabase } from './src/database.ts';
import { loadConfig } from './src/config.ts';
import { writeEpgAtomic } from './src/epg.ts';
const config = loadConfig();
const db = new LkpDatabase(config.storage.database);
writeEpgAtomic(db.listSchedule(Date.now() - 86400000, Date.now() + config.schedule.epgDays * 86400000), config);
db.close();
console.log(`Weather database: ${config.storage.database}\nEPG: ${config.epg.output}\nGenerated media: ${config.media.generatedRoot}`);
NODE
printf 'Backup: %s\n' "$backup"
