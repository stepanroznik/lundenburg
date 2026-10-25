#!/usr/bin/env bash
# Unprivileged supplement for an existing system weather timer still using noon.
set -euo pipefail
cd "$(dirname "$0")/.."
test "$(id -un)" = lundenburg
unit_root="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_root"
install -m 644 deploy/systemd/lkp-weather-afternoon.service deploy/systemd/lkp-weather-afternoon.timer "$unit_root/"
systemd-analyze --user verify "$unit_root/lkp-weather-afternoon.service" "$unit_root/lkp-weather-afternoon.timer"
systemctl --user daemon-reload
systemctl --user enable --now lkp-weather-afternoon.timer
systemctl --user show lkp-weather-afternoon.timer -p ActiveState -p NextElapseUSecRealtime
