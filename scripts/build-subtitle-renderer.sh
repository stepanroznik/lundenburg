#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tools_dir="$PWD/runtime/tools/dvb-subtitles"
mkdir -p "$tools_dir/headers"
if [ ! -f "$tools_dir/headers/usr/include/ass/ass.h" ]; then
packages_dir=$(mktemp -d "$tools_dir/packages.XXXXXX")
cd "$packages_dir"
# Headers only, unpacked locally: no system packages or running FFmpeg changed.
apt-get download libavcodec-dev=7:7.1.5-0+deb13u1 libavformat-dev=7:7.1.5-0+deb13u1 libavutil-dev=7:7.1.5-0+deb13u1 libass-dev
for package in "$packages_dir"/*.deb; do dpkg-deb -x "$package" "$tools_dir/headers"; done
fi
cd /home/lundenburg/lundenburg
gcc -O2 -Wall -Wextra -Werror -I "$tools_dir/headers/usr/include" \
  -I "$tools_dir/headers/usr/include/aarch64-linux-gnu" \
  scripts/dvb-subtitles.c -o "$tools_dir/render" \
  -Wl,-l:libavcodec.so.61 -Wl,-l:libavformat.so.61 -Wl,-l:libavutil.so.59 -Wl,-l:libass.so.9 -lm
printf 'Built %s/render\n' "$tools_dir"
