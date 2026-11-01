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
mkdir -p "$backup/renderer" "$backup/systemd"
node --import tsx --input-type=module - "$backup" <<'NODE'
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from './src/config.ts';
const db = new Database(loadConfig().storage.database, { readonly: true });
const backup=path.join(process.argv[2], 'lkp.sqlite');
await db.backup(backup);fs.chmodSync(backup,0o600);
db.close();
NODE
# Source and its dependency manifests are one deployment. Preserve renderer
# runtime, credentials, cached speech, generated media and local configuration.
cp -a "$renderer/src" "$renderer/package.json" "$renderer/package-lock.json" "$renderer/tsconfig.json" "$backup/renderer/"
if [ -d "$renderer/test" ]; then cp -a "$renderer/test" "$backup/renderer/"; fi
rsync -a "$root/src/" "$renderer/src/"
rsync -a "$root/test/" "$renderer/test/"
cp "$root/package.json" "$root/package-lock.json" "$root/tsconfig.json" "$renderer/"
cp "$root/scripts/verify-weather-installation.mjs" "$renderer/scripts/"
if ! (cd "$renderer" && node scripts/verify-weather-installation.mjs --dependencies-only); then
  # Retain existing native modules; install exactly the synchronized lockfile.
  (cd "$renderer" && npm install --ignore-scripts --no-audit --no-fund)
  # Older Pi npm rewrites peer flags even when all locked versions are kept.
  cp "$root/package-lock.json" "$renderer/package-lock.json"
fi
mkdir -p "$backup/renderer/config" "$backup/renderer/scripts"
cp -a "$renderer/config/lkp.yaml" "$backup/renderer/config/lkp.yaml"
cp -a "$renderer/scripts/install-weather-pi.sh" "$backup/renderer/scripts/install-weather-pi.sh"
cp "$root/scripts/install-weather-pi.sh" "$renderer/scripts/install-weather-pi.sh"
bash "$renderer/scripts/install-weather-pi.sh" --configure-only
(cd "$renderer" && node scripts/verify-weather-installation.mjs)
(cd "$renderer" && npm run check)
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
const config = loadConfig();
const db = new LkpDatabase(config.storage.database);
db.close();
console.log(`Weather database: ${config.storage.database}\nEPG: ${config.epg.output}\nGenerated media: ${config.media.generatedRoot}`);
NODE
printf 'Backup: %s\n' "$backup"
