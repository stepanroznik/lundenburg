#!/usr/bin/env bash
# Run as lundenburg in /home/lundenburg/lkp-weather. This never restarts playout.
set -euo pipefail
cd "$(dirname "$0")/.."
test "$(id -un)" = lundenburg || { echo 'Run this installer as lundenburg.' >&2; exit 1; }
test "$(pwd)" = /home/lundenburg/lkp-weather || { echo 'Use the isolated /home/lundenburg/lkp-weather directory.' >&2; exit 1; }

find_browser() {
  local candidate
  for candidate in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/chromium-headless-shell /usr/bin/google-chrome; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

browser_path="$(find_browser || true)"
if [ -z "$browser_path" ] || ! command -v ffmpeg >/dev/null; then
  sudo apt-get -o Acquire::Retries=3 update
fi
if [ -z "$browser_path" ]; then
  # Raspberry Pi OS publishes a Chromium build from archive.raspberrypi.com,
  # but weather rendering does not require that customized build. Prefer the
  # Debian build so a temporary Pi-mirror DNS failure cannot block setup.
  debian_chromium_version="$(apt-cache madison chromium | awk '$3 !~ /rpt/ { print $3; exit }')"
  if [ -n "$debian_chromium_version" ]; then
    chromium_packages=(
      "chromium=$debian_chromium_version"
      "chromium-common=$debian_chromium_version"
    )
    if apt-cache madison chromium-sandbox | awk -v version="$debian_chromium_version" '$3 == version { found=1 } END { exit !found }'; then
      chromium_packages+=("chromium-sandbox=$debian_chromium_version")
    fi
    sudo apt-get -o Acquire::Retries=3 install -y --no-install-recommends "${chromium_packages[@]}"
  else
    sudo apt-get -o Acquire::Retries=3 install -y --no-install-recommends chromium
  fi
  browser_path="$(find_browser || true)"
  test -n "$browser_path" || { echo 'Chromium installation completed but no supported browser executable was found.' >&2; exit 1; }
fi
if ! command -v ffmpeg >/dev/null; then
  sudo apt-get -o Acquire::Retries=3 install -y --no-install-recommends ffmpeg
fi
echo "Weather renderer will use $browser_path"
npm ci --no-audit --no-fund
npm run check
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import {parse, stringify} from 'yaml';
const root='/home/lundenburg/lundenburg';
const env=fs.existsSync('/etc/lkp.env') ? Object.fromEntries(fs.readFileSync('/etc/lkp.env','utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const n=l.indexOf('=');return [l.slice(0,n),l.slice(n+1).trim().replace(/^['"]|['"]$/g,'')];})) : {};
const config=parse(fs.readFileSync(env.LKP_CONFIG || path.join(root,'config/lkp.yaml'),'utf8'));
config.storage.database=env.LKP_DATABASE || config.storage.database;
if(env.LKP_MEDIA_ROOT) config.media.root=env.LKP_MEDIA_ROOT;
for(const [section,key] of [['storage','database'],['storage','runtimeDirectory'],['epg','output'],['logo','path'],['broadcast','fifo'],['broadcast','transmitter'],['media','root']]) config[section][key]=path.resolve(root,config[section][key]);
if(!fs.existsSync(config.storage.database)) throw new Error('The authoritative playout database is missing; configure it before enabling weather.');
fs.mkdirSync('config',{recursive:true});
fs.writeFileSync('config/lkp.yaml',stringify(config));
console.log('Weather will publish to '+config.storage.database);
NODE
test -s runtime/weather/credentials.env || { echo 'Put ELEVENLABS_API_KEY in runtime/weather/credentials.env before enabling the timer.' >&2; exit 1; }
chmod 600 runtime/weather/credentials.env
sudo install -m 644 deploy/systemd/lkp-weather.service /etc/systemd/system/lkp-weather.service
sudo install -m 644 deploy/systemd/lkp-weather.timer /etc/systemd/system/lkp-weather.timer
sudo install -m 644 deploy/systemd/lkp.target /etc/systemd/system/lkp.target
sudo systemctl daemon-reload
# Do not enable/start lkp.target here: playout may already be running manually.
# systemd keeps a single instance of this oneshot service running at a time.
sudo systemctl enable --now lkp-weather.timer
systemctl list-timers lkp-weather.timer --no-pager
echo 'Weather timer installed. Playout was not restarted. Logs: journalctl -u lkp-weather.service'
