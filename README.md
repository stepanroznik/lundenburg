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

## Weather show

The weather module prepares standalone 1080p30 H.264/AAC MP4 programmes. It
does not start DVB or RF. Four layered SVG presenters share a recurring studio
with a real OpenStreetMap railway/river map and a **Lundenburg** label.

The initial voiced render has been reviewed. The revised atlas, character details
and explicitly future-tense narration need a new complete render. The commands
below can take several minutes.

### First episode

Use Node 24 for this checkout (its existing SQLite addon was compiled for Node
24), or rebuild `better-sqlite3` when switching Node major versions. FFmpeg, ffprobe and a
Chromium browser are required. Set `WEATHER_BROWSER` to an existing executable
if it is not `/usr/bin/google-chrome`; otherwise Remotion may download its own
browser. Store `ELEVENLABS_API_KEY` in the environment or in the ignored,
owner-only `runtime/weather/credentials.env` file. Only TTS access is needed:
the code never requests voice lists, voice metadata or account information.

```bash
# Once: download real geographic features, cached for offline rendering.
npm run weather:map

# Real weather, automatically fetched; no fixture option:
npm run weather:generate -- --render

# Deliberately fictional mixed weather ONLY for clothing/graphics review:
npm run weather:generate -- --edition evening --fixture mixed --render

# No API charges: visual-only timeline, then render one representative frame.
npm run weather:preview -- --edition evening
npm run weather:render -- \
  --episode runtime/weather/episodes/YYYY-MM-DD/evening-preview --still 150

# Re-render cached speech without regenerating any narration:
npm run weather:render -- \
  --episode runtime/weather/episodes/YYYY-MM-DD/evening-preview
```

The generation command prints the exact episode directory. Do not run the
silent preview command over a voiced preview you want to preserve: it replaces
that edition's preview timeline (the permanent speech cache remains intact).
For quick visual work, `--presenter sisi`, `--scale 0.5` and `--frames 90-180`
are available on generation/render commands as appropriate. `--audio cache`
uses only existing speech; `--audio silent` produces clearly marked previews.
The fixture label appears on the opening card, not throughout the forecast.
`mixed` includes snow at -2°C in Bratislava by design. It is never live weather.
Fixtures: `sunny`, `rainy`, `storm`, `snow`, `heatwave`, `windy`, `mixed`.
Mock/silent/single-presenter/partial renders cannot be published.

### Voices and cached audio

| Presenter | Language | Voice ID | Speed | Processing |
| --- | --- | --- | --- | --- |
| Knurpsi | German | `eerdi6005Xy1VVWpejx6` | 0.84 | Warm, clear |
| Sisi | German | `AAiTaAHdZuRZAfYWRq5V` | 0.82 | Slightly brighter EQ |
| Schalinka | Czech | `6Aa0226VrdZ4mFzZjj82` | 0.90 | Balanced EQ |
| Haluschka | Slovak | `AAiTaAHdZuRZAfYWRq5V` | 0.88 | Slightly warmer EQ |

Sisi and Haluschka intentionally share a raw voice. No pitch shift is applied.
All four voices receive measured two-pass loudness normalization to -18 LUFS
with a -2 dBTP target, including Schalinka. The content hash includes text,
language, voice ID, model, speed, voice settings, processing profile, actual EQ,
loudness targets, output format and lip-sync version. Completed speech and
analysis are retained indefinitely. Failed processing can reuse its saved raw
TTS response. A failed provider request stops generation; there are no automatic
paid retries or substitute voices. Existing scheduled programmes are unaffected.

Mouth shapes use actual character timestamps from ElevenLabs, with six mouth
states and silence/rest handling. This is a lightweight grapheme-to-mouth
approximation, not phoneme recognition; judge German/Czech/Slovak alignment in
the first render before deciding whether to add Rhubarb. Speech is generated
at natural sentence boundaries, never spliced from isolated words.

`npm run weather:usage` shows local daily/monthly requested characters and cache
hits by presenter. This is diagnostic accounting, not the provider's invoice.
Locks record process identity and boot ID: a new run recovers locks left by a
killed process or Pi reboot. A lock still owned by a running process is respected.
Empty legacy locks from older versions require manual inspection/removal.

### Fresh weather and scheduling

`config/weather.yaml` defines Prague edition windows, generation lead time,
maximum forecast age, voice model/settings, loudness and render concurrency.
Morning covers now/afternoon/evening/tomorrow; afternoon covers
now/evening/tomorrow; evening covers now/tomorrow. Open-Meteo is fetched once for
all four cities for each generation. Hourly data is normalized deterministically;
future-period icons summarize the most significant condition and temperature
labels show that period's maximum. Recent cached source data is allowed only
within the configured age and only if it covers every required forecast hour.
Unavailable/expired weather stops generation instead of inventing a forecast.
Current-period conditions use present tense; future periods use explicit future
tense in all three languages, including German temperature sentences. Changes
generate only the newly required sentence atoms; no outdated present-tense atom
is substituted for a future forecast. The large map heading/date and every city's
card all show the same period. Tomorrow advances the date in Prague local time.

```bash
# Supply the intended future broadcast time (Prague local time if no offset):
npm run weather:generate -- \
  --edition afternoon --at 'YYYY-MM-DDT14:15:00+02:00' --render

# Explicitly insert the completed edition into the authoritative schedule:
npm run weather:publish -- \
  --episode runtime/weather/episodes/YYYY-MM-DD/afternoon

# Or prepare, render and publish the due edition near a future boundary:
npm run weather:auto
```

**Publishing inserts at a future programme boundary and shifts later programmes
by the episode duration.** It keeps programmes whole and changes no past or
currently playing event. The operation is transactional, rejects duplicate or
expired editions, and refreshes EPG. Normal append-only schedule generation is
unchanged. Weather stays outside the weighted catalogue so it cannot repeat a
year later. Publishing also checks that shifted weather remains valid. These
commands must access the same SQLite schedule and media filesystem as playout.

The timer starts generation at **05:00, 12:00 and 17:00 Europe/Prague**, one hour
before the default edition windows. It fetches fresh data on each run and selects
a future programme boundary from the existing schedule. If preparation finishes
late, publication uses the next safe boundary within validity; if none exists,
ordinary programming continues. When changing the window/lead settings, adjust
`OnCalendar` in the timer to match. `Persistent=true` checks a missed activation
after reboot. No weather is inserted until the entire render succeeds.

### Independent Pi service

From the workstation, run the following installer (package installation and
copying cached speech can exceed 30 seconds):

```bash
bash scripts/deploy-weather.sh
```

It creates `/home/lundenburg/lkp-weather` on the Pi as a **separate installation**,
copies the geographic snapshot and permanent speech cache, installs Chromium and
the renderer dependencies, and enables `lkp-weather.timer`. It does not restart
or replace the existing playout installation. Its generated `config/lkp.yaml`
points to the broadcaster's existing SQLite database and EPG output, respecting
the paths in `/etc/lkp.env`. The supplied credentials file is transferred with
owner-only permissions. No API key is embedded in the service or repository.

Rendering uses one worker, idle CPU scheduling on cores 0–1 (the playout cores),
a 50% CPU quota, idle I/O, a 768 MB soft memory limit and a 1 GB hard limit, with
swap disabled. Radio cores 2–3 are excluded. These controls prioritize playout;
Pi render duration and broadcast stability still need to be measured together.
Do not infer a throughput guarantee from workstation timings. If rendering is
killed or a provider is unavailable, the existing schedule continues unchanged.

The cached 2200×1520 atlas replaces per-frame processing of thousands of OSM paths
without lowering output resolution. Fully opaque intro/outro scenes skip drawing
the hidden studio. Desktop renders default to eight workers (capped by available
CPU parallelism); `WEATHER_RENDER_CONCURRENCY` overrides this, and the Pi service
always uses one. `render-timing.json` records setup, frame rendering, encoding,
worker count and the slowest frames, so a full render can be compared without
generating any more speech. Short previews write `preview-render-timing.json`.
Programme output remains 1080p30 at the same encoding settings. Optional
`lkp.target` groups the existing broadcaster and weather timer for a single boot
target; the installer does not start that target or start RF transmission.

```bash
# On the Pi:
systemctl list-timers lkp-weather.timer
journalctl -u lkp-weather.service -n 50
# Manual generation uses the same protected resource limits:
sudo systemctl start lkp-weather.service
```

Each episode directory archives the raw source, normalized forecast, script,
timeline, original-language VTT, per-language SRT, MP4, programme metadata,
generation report and (after publication) schedule entry. Subtitles remain text
sidecars; the existing DVB bitmap conversion limitation still applies. The
soundtrack has an original quiet opening/closing sting; continuous background
music and extra effects are deliberately deferred until voice intelligibility
has been reviewed.

The first version needs no OpenAI key. `WeatherCopyGenerator` can optionally
choose among approved character reactions; failures/invalid choices use the
deterministic fallback. Unrestricted LLM rewrites and an OpenAI adapter are not
enabled. Weather facts, temperatures and temporal wording remain deterministic.

Implementation: `src/weather/{forecast,narration,speech,episode,render,publish}.ts`,
the CLI in `src/weather/cli.ts`, and SVG studio/characters in
`src/weather/video`. The map data licence and attribution are documented in
`assets/weather/README.md`. No weather skill is created yet.
