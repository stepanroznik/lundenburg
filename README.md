# Lundenburg Kids Premium

LKP is a wall-clock-authoritative television playout service. Its SQLite schedule, not process uptime, decides what is on air. Starting at 18:31 during an event scheduled for 18:24:30 seeks 6:30 into that event, retains its original EPG times, and switches at the next stored boundary.

The application is TypeScript. FFmpeg/ffprobe handle media, TSDuck injects DVB EIT, and the retained GNU Radio flowgraph drives the HackRF. RF is never used by tests and requires an explicit acknowledgement. The configured and transmitter-level default gain is **14 dB**.

The default Raspberry Pi 5 playout profile is 1920×1080 at 30 fps and 3.8 Mb/s. FFmpeg uses the `ultrafast` x264 preset and is pinned to CPU cores 0–1, leaving cores 2–3 available to GNU Radio and the HackRF path. The logo remains a live overlay, but LKP rasterizes the committed SVG once into a size- and opacity-specific transparent PNG cache before playout; it never renders the SVG for every programme frame.

## What is implemented

- recursive media discovery with ffprobe-derived duration and stream metadata;
- `show.yaml` and episode YAML metadata with filename inference;
- persistent SQLite catalogue, schedule, and actual playout log;
- deterministic weighted scheduling, episode order, no gaps/overlaps, no adjacent repeat when another show exists, and append-only extension;
- exact current-event lookup and cold-start seek;
- live 1080p30 logo overlay, with a three-rotation/ease-out zoom animation only at real programme transitions;
- stable service/TS/ONID and elementary-stream PID configuration;
- rolling TSDuck EIT input containing full event times and descriptions;
- sidecar and embedded subtitle discovery (`cs`, `de`, `en`), with pass-through of genuine DVB bitmap inputs;
- XLSX worksheets for Schedule, Playback Log, and Comparison;
- dry-run MPEG-TS output, diagnostics, systemd unit, and automated tests.

## Installation on the Pi

Debian 13 packages supply Node.js 20, npm, FFmpeg 7, GNU Radio, and HackRF tools. TSDuck provides an official Debian 13 arm64 package from its [binary downloads](https://tsduck.io/tsduck-binaries/).

```bash
sudo apt update
sudo apt install nodejs npm ffmpeg python3-gnuradio gnuradio-dev gr-soapy hackrf

cd /home/lundenburg/lundenburg
npm ci
npm run build
npm test
```

The runtime needs `tsp` only for RF/EIT output. Catalogue, schedule, export, tests, and file-only dry runs work independently.

## Media library

Media stays outside Git. The Pi default is `/home/lundenburg/lkp-media`; override it with `LKP_MEDIA_ROOT` or `media.root` in [config/lkp.yaml](config/lkp.yaml).

```text
/home/lundenburg/lkp-media/
  a-show/
    show.yaml
    S01E01 - Episode title.mp4
    S01E01 - Episode title.yaml
    S01E01 - Episode title.cs.srt
    S01E01 - Episode title.de.ass
```

Supported video containers are MKV, MP4, and MOV. `show.yaml` supports `id`, `title`, `description`, `language`, `weight`, and `enabled`. Episode YAML supports `id`, `title`, `description`, `season`, `episode`, and `enabled`. Obvious season, episode, and title data are parsed from `S01E03 - Title.mp4`; YAML only supplies or overrides what cannot be inferred. See [examples/media-library](examples/media-library) for the live catalogue’s metadata.

Sidecars must be UTF-8 and use the exact video stem plus `.cs.srt`, `.de.srt`, `.en.srt` (ASS is also indexed). Source files are never rewritten by the scanner.

### Important DVB subtitle boundary

SRT, ASS, and MP4 `mov_text` are text; DVB subtitles are bitmap display sets. FFmpeg 7.1.5 can encode bitmap-to-bitmap DVB subtitles but cannot safely perform this text-to-bitmap conversion. LKP therefore never burns captions into video and never labels a text stream as DVB. It indexes text tracks and passes already-prepared `dvb_subtitle` tracks as selectable TV subtitles. A preparation cache using a verified text-to-DVB renderer still needs end-to-end validation before the current Czech SRT tracks can appear on a television. This is intentionally explicit rather than silently compromising subtitle selection.

## Logo

The supplied SVG is committed at [assets/logo/lkp-logo.svg](assets/logo/lkp-logo.svg). At broadcast startup it is rasterized once into `runtime/graphics`; the cached transparent PNG is then composited live, so source programmes remain untouched and future graphics can use the same live compositor. Width, position, opacity, transition duration, rotations, and zoom are in `config/lkp.yaml`.

## Catalogue and schedule

```bash
npm run media:scan
npm run schedule:generate
npm run schedule:show

# Ask what is on, including seek offset:
npm run lkp -- schedule show --at '2026-12-24T18:35:00'

# Safely append to a two-year horizon:
npm run schedule:generate -- --days 730

# Destructive, deterministic rebuild (normally avoid):
npm run schedule:generate -- --force --from 2026-10-01
```

Times entered without an offset are interpreted in `Europe/Prague`. SQLite stores unambiguous UTC epoch milliseconds. Existing entries never move during normal extension; the configured seed affects only deterministic selection.

The default horizon is 365 days and DVB EPG window is seven days. Generate/inspect EIT source with:

```bash
npm run lkp -- epg generate
less runtime/epg.xml
```

TSDuck `eitinject` reorganizes those events into actual present/following and schedule EIT at runtime.

## Export

```bash
npm run schedule:export
npm run schedule:export -- --from 2026-10-01 --to 2026-10-31 --output runtime/october.xlsx
```

Excel dates/times are real cells displayed in Prague civil time. Headers are frozen and filtered.

## Playout and diagnostics

Run diagnostics first:

```bash
npm run doctor
npm run doctor -- --rf
```

File-only preview (no RF):

```bash
npm run broadcast:start -- --dry-run --max-seconds 15 --output runtime/preview.ts
ffprobe runtime/preview.ts
```

Long-running dry-run omits `--once`. At startup the service locates the stored current event, seeks by `now - startsAt`, and shows a static logo. Later scheduled boundaries receive the transition animation. Each actual attempt and its initial seek/result are stored in `playback_log`.

RF is regulated spectrum. Only after checking local rules, load, transport analysis, and a shielded/short-range setup:

```bash
npm run broadcast:start -- --rf --i-understand-rf
```

Override the configured HackRF TX gain for one run (valid range: 0–30 dB):

```bash
npm run broadcast:start -- --rf --i-understand-rf --gain 16
```

This starts the continuous TSDuck/GNU Radio pipeline at the configured **14 dB**. Stop with Ctrl-C. The unit keeps stable IDs and PIDs while child FFmpeg processes change at authoritative boundaries.

## systemd

The supplied unit is not installed or enabled automatically.

```bash
sudo cp deploy/lkp.env.example /etc/lkp.env
sudo cp deploy/systemd/lkp.service /etc/systemd/system/lkp.service
sudo systemctl daemon-reload
sudo systemctl enable --now lkp.service

journalctl -u lkp.service -f
sudo systemctl stop lkp.service
```

Review `/etc/lkp.env`, especially the RF acknowledgement and 14 dB gain, before enabling. The service restarts after failure and terminates supervised children on stop.

## Verification

```bash
npm run check
npm test
ffprobe runtime/preview.ts
tsp -I file runtime/preview.ts -P analyze -O drop
tsp -I file runtime/preview.ts -P eit --summary --epg-dump -O drop
```

Automated coverage includes determinism, persistence, extension, episode order, no gaps/overlaps, exact programme boundaries, cold-start seek inputs, Prague DST transitions, EPG values, filename parsing, and logo animation endpoints. Real-TV verification remains mandatory before unattended RF operation: tune persistence, H.264 decode/load, logo animation, p/f and future EPG, descriptions, prepared bitmap subtitles, restart seeking, and programme transitions all need observation on the target set.

## Layout

- `src/media.ts` — discovery, metadata, ffprobe, subtitles
- `src/database.ts` — SQLite persistence boundary
- `src/schedule.ts` — deterministic append-only scheduling
- `src/playout.ts` — wall-clock supervisor and FFmpeg/TSDuck orchestration
- `src/epg.ts` — rolling TSDuck EIT event XML
- `src/export.ts` — XLSX audit export
- `scripts/transmit.py` — minimal GNU Radio/HackRF integration retained from the proven PoC
- `deploy/systemd` — production service definition
- `data` and `runtime` — ignored mutable state
