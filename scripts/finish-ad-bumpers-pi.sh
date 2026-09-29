#!/usr/bin/env bash
set -euo pipefail
cd /home/lundenburg/lundenburg
mkdir -p runtime/advertising
status_file=runtime/advertising/finish-status.txt
trap 'printf "failed (see finish.log)\n" > "$status_file"' ERR
printf "building\n" > "$status_file"
npm run build
printf "rendering four animated masters\n" > "$status_file"
export AD_BUMPER_CONCURRENCY=1
npm run lkp -- ads bumpers --audio cache
printf "refreshing future schedule plans\n" > "$status_file"
npm run lkp -- schedule replan --refresh-bumpers
npm run lkp -- epg generate
npm run lkp -- schedule export
node scripts/cleanup-old-ad-bumpers.mjs
printf "complete\n" > "$status_file"
