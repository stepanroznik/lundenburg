#!/usr/bin/env bash
# Run as lundenburg in /home/lundenburg/lkp-weather. This never restarts playout.
set -euo pipefail
cd "$(dirname "$0")/.."
test "$(id -un)" = lundenburg || { echo 'Run this installer as lundenburg.' >&2; exit 1; }
test "$(pwd)" = /home/lundenburg/lkp-weather || { echo 'Use the isolated /home/lundenburg/lkp-weather directory.' >&2; exit 1; }
sudo apt-get update
sudo apt-get install -y chromium ffmpeg
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
