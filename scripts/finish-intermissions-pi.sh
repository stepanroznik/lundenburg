#!/usr/bin/env bash
# User-run final step. Codex intentionally does not execute this script.
set -euo pipefail
cd "$(dirname "$0")/.."
test -d /home/lundenburg/lundenburg || { echo 'Run this finish command on the Pi.' >&2; exit 1; }
npm run intermissions:prepare -- --audio cache
npm run intermissions:render -- --skip-existing
npm run intermissions:stills
npm run intermissions:gallery
npm run intermissions:publish
npm --prefix /home/lundenburg/lundenburg run lkp -- schedule intermissions
echo 'Finished: the new intermissions are in the future programme schedule.'
