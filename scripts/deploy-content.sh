#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo"
# Compare and merge both checkouts and the active release before running this
# script, as required by skills/lkp-show-production/SKILL.md.
npm run check
npm test
release=$(date -u +%Y%m%dT%H%M%SZ)
remote="/home/lundenburg/lkp-content/releases/$release"
prepared="/home/lundenburg/lkp-content/prepared-$release"
ssh -o BatchMode=yes lkp-pi 'mkdir -p /home/lundenburg/lundenburg/runtime/deploy-backups'
# Save code, excluding private runtime, databases, dependencies and media.
ssh -o BatchMode=yes lkp-pi "tar -C /home/lundenburg/lundenburg -czf /home/lundenburg/lundenburg/runtime/deploy-backups/source-$release.tar.gz src test scripts tools skills config package.json package-lock.json"
rsync -a src test scripts tools skills dist package.json package-lock.json AGENTS.md README.md ACQUISITION.md INTERMISSIONS.md lkp-pi:/home/lundenburg/lundenburg/
rsync -a config/lkp.yaml config/content-acquisition.yaml config/ai.yaml config/acquisition-sources.yaml config/educational-seeds.json lkp-pi:/home/lundenburg/lundenburg/config/
ssh -o BatchMode=yes lkp-pi "cd /home/lundenburg/lundenburg && node scripts/prepare-content-release.mjs /home/lundenburg/lkp-content/current '$prepared' && node scripts/activate-content-release.mjs '$prepared' '$remote' --after-current-batch --preserve-publication-policy"
printf 'Deployed merged acquisition release %s.\n' "$release"
