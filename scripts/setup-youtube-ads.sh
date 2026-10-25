#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
tools="$PWD/runtime/tools/youtube-ads"
deno_source="${LKP_DENO:-$(command -v deno || true)}"
if [ -z "$deno_source" ] || [ ! -x "$deno_source" ]; then
  echo 'Set LKP_DENO to an installed Deno 2 or newer executable.' >&2
  exit 1
fi
mkdir -p "$tools" runtime/youtube
if [ "$deno_source" != "$tools/deno" ]; then cp "$deno_source" "$tools/deno"; fi
python3 -m venv "$tools/venv"
"$tools/venv/bin/python" -m pip install 'yt-dlp[default]==2026.10.21' 'bgutil-ytdlp-pot-provider==2.0.2'
if [ ! -d "$tools/bgutil-provider" ]; then
  git clone --depth 1 --branch 2.0.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$tools/bgutil-provider"
fi
if [ "$(git -C "$tools/bgutil-provider" rev-parse HEAD)" != 26475e9d3665b972c4aeb83b4dbaafcf64b88438 ]; then
  echo 'Unexpected playback provider revision; preserving it for inspection.' >&2
  exit 1
fi
cd "$tools/bgutil-provider/server"
"$tools/deno" install --allow-scripts=npm:canvas --frozen
