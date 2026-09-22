#!/usr/bin/env bash
# Run on the development workstation, not on the Pi. Package installation can exceed 30 seconds.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -r /proc/device-tree/model ] && grep -q 'Raspberry Pi' /proc/device-tree/model; then
  echo 'Run this deployer on the development workstation; it copies and installs the weather service on the Pi.' >&2
  exit 1
fi
destination="${1:-lundenburg@10.0.1.46}"
remote_root=/home/lundenburg/lkp-weather
test -s assets/weather/region.json || { echo 'Prepare the geographic snapshot with npm run weather:map first.' >&2; exit 1; }
command -v rsync >/dev/null
ssh "$destination" "mkdir -p $remote_root/runtime/weather/public"
# A separate installation avoids changing the running broadcaster's modules.
rsync -aR package.json package-lock.json tsconfig.json src config/weather.yaml assets/weather deploy/systemd/lkp-weather.service deploy/systemd/lkp-weather.timer deploy/systemd/lkp.target scripts/install-weather-pi.sh "$destination:$remote_root/"
# Keep permanent speech atoms: setup should not spend credits recreating them.
if [ -d runtime/weather/public/speech ]; then
  rsync -a --exclude=.lock runtime/weather/public/speech "$destination:$remote_root/runtime/weather/public/"
fi
if [ -f runtime/weather/credentials.env ]; then
  rsync -a --chmod=F600 runtime/weather/credentials.env "$destination:$remote_root/runtime/weather/credentials.env"
fi
ssh -t "$destination" "cd $remote_root && bash scripts/install-weather-pi.sh"
