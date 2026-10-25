# Lundenburg Kids Premium

LKP uses its SQLite schedule as the reference television timeline. A cold start at 18:31 during an event scheduled for 18:24:30 seeks 6:30 into that event. During continuous playout, EOF advances to the next piece without replaying or freezing the ending. Early running is carried forward and recovered with suitable longer or shorter published intermissions; the stored schedule remains unchanged.

The application is TypeScript. FFmpeg/ffprobe handle media. The same encoded H.264/MP2 transport stream can feed TSDuck/GNU Radio for DVB-T, a lightweight HLS relay for Internet viewing, or both. RF is never used by tests and requires an explicit acknowledgement. The configured and transmitter-level default gain is **21 dB**.

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
- configurable `dvb`, `internet`, and `both` output modes from one playout source;
- an authenticated HLS player exposed through Tailscale Funnel HTTPS.
- configurable Lundenburg Nacht and daytime profiles sharing the catalogue,
  schedule, EPG, and continuous broadcast pipeline. See [NACHT.md](NACHT.md) and its
  [design language](NACHT-DESIGN.md).

For NetworkManager disconnect recovery, installation and read-only checks, see
[WIFI_RECOVERY.md](WIFI_RECOVERY.md).

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

## Children’s age and programme clock

[Age-aware scheduling](CHILDREN-SCHEDULING.md) documents the full catalogue’s editorial age ranges, recurring programme anchors with a five-second tolerance, short-episode assemblies, next-day repeats and safe persistent age changes. Initial target age: 3; tolerance: 1 year. Rachel and Josi have a strict target-age ceiling of 5.

## Media library

Media stays outside Git on the mounted USB hard drive. The Pi default is
`/mnt/lkp-media/LKP`; override it with `LKP_MEDIA_ROOT` or `media.root` in
[config/lkp.yaml](config/lkp.yaml). The configured `mountPoint` makes diagnostics
fail closed if the drive is absent, preventing accidental writes to the Pi's SD
card. Generated programmes live below `.generated` on the same drive.

```text
/mnt/lkp-media/LKP/
  a-show/
    show.yaml
    S01E01 - Episode title.mp4
    S01E01 - Episode title.yaml
    S01E01 - Episode title.cs.srt
    S01E01 - Episode title.de.ass
```

Place one `show.yaml` at the root of each show. Nested season or download folders
inherit that metadata, so they do not become separate shows. Hidden directories,
including `.generated`, are excluded from the ordinary weighted catalogue.

Supported video containers are MKV, MP4, and MOV. `show.yaml` supports `id`, `title`, `description`, `language`, `weight`, and `enabled`. Episode YAML supports `id`, `title`, `description`, `season`, `episode`, and `enabled`. Obvious season, episode, and title data are parsed from `S01E03 - Title.mp4`; YAML only supplies or overrides what cannot be inferred. See [examples/media-library](examples/media-library) for the live catalogue’s metadata.

Add `kind: movie` to a film's `show.yaml` to exclude season/episode numbering.
Series retain source episode numbers or receive stable local catalogue numbers;
seasons remain optional. Scanning and acquisition share title cleanup and numbering
rules. `npm run lkp -- media normalize` previews existing metadata changes without
probing videos; `--write` backs up SQLite and sidecars, then updates the catalogue, episode YAML and future listing metadata without changing programme times or event IDs.
See [ACQUISITION.md](ACQUISITION.md) for numbering provenance and scheduling boundaries.

Sidecars must be UTF-8 and use the exact video stem plus `.cs.srt`, `.de.srt`, `.en.srt` (ASS is also indexed). Source files are never rewritten by the scanner.

### Ingest and editorial metadata

A source file remains immutable. Ingest now persists separate show, episode,
media-asset, subtitle-track and editorial-marker records while keeping the old
`media_items` compatibility view for existing installations. SQLite migration is
additive; it does not clear the catalogue or schedule. Episode YAML can add:

```yaml
externalIds: { imdb: tt1234567, tmdb: '12345', tvdb: '67890' }
creditsPolicy: shorten # full, shorten, skip
markers:
  - { kind: credits, startMs: 3120000, endMs: 3240000, source: manual, confidence: 1 }
breakpoints:
  - 1482400
  - { atMs: 3118700, enabled: true, reason: [manual act boundary] }
```

Embedded chapters are retained and scored during `media:scan`. Uncertain credits
are never cut automatically; provider failures become QC warnings. Inspect one
asset or the whole ingest summary with:

```bash
npm run lkp -- media show MEDIA_ID
npm run lkp -- media report
```

Optional TheIntroDB/ChaptersDB/subtitle services plug into independent ingest
adapters; the live broadcaster never contacts them. Only Czech, German and
English subtitle tracks are considered by ordinary library ingest.

### Important DVB subtitle boundary

SRT, ASS, and MP4 `mov_text` are text; DVB subtitles are bitmap display sets.
LKP prepares text tracks offline with libass and FFmpeg's native DVB encoder,
then decodes and validates the bitmap payload before publishing its cache.
The original programme files remain immutable; captions are never burned in.
Prepared tracks live under `/mnt/lkp-media/LKP/.generated/lkp-subtitles` and
are mapped as separate, selectable DVB streams during playout. Czech, German,
English and Slovak have stable PIDs and explicit language descriptors.
HD display sets advertise DVB subtitling type `0x14` (HDTV), with matching
composition/ancillary page IDs; software decoding alone is not a receiver test.
Caption regions use 16-colour/4-bit encoding for receiver compatibility, with
white glyphs, black outlines and transparency validated after decoding.
Large or widely positioned ASS captions are split into cropped regions no larger
than 256×64 pixels, avoiding oversized DVB objects and transparent pixel buffers.
Text is rendered at 65% of the source font size (including inline size overrides),
preserving cue timing and alignment; original subtitle files remain unchanged.
Missing or unfinished caches do not appear on air. Caption display sets repeat once per
second to support tuning and cold-start seeks; editorial content ranges seek
the original subtitle timeline, while ads/intermissions have no inherited captions.

```bash
# Build locally without replacing system packages (Pi / FFmpeg 7.1).
bash scripts/build-subtitle-renderer.sh
# Prepare available captions; sources and programme timing are unchanged.
npm run subtitles:prepare
npm run subtitles:prepare -- --id MEDIA_ID
npm run subtitles:prepare -- --weather-only
```

Run preparation after new library ingest. Weather generation automatically
prepares its original-language caption tracks when the optional converter is
installed. This implements DVB subtitles, not teletext page 888. Internet HLS
currently carries video/audio only and does not expose these DVB tracks.

## Logo

The supplied SVG is committed at [assets/logo/lkp-logo.svg](assets/logo/lkp-logo.svg). At broadcast startup it is rasterized once into `runtime/graphics`; the cached transparent PNG is then composited live, so source programmes remain untouched and future graphics can use the same live compositor. Width, position, opacity, transition duration, rotations, and zoom are in `config/lkp.yaml`.

## Lundenburg Nacht

The imported Pi configuration enables both profiles. LN shares the station's
persistent clock schedule and MPEG-TS pipeline. Its Europe/Prague handovers are
wall-clock based, while separate age policies keep
unknown catalogue items on LKP by default. The dark navy and champagne identity,
Remotion source, pre-rendered transitions, acquisition subscriptions and guarded
activation are documented in [NACHT.md](NACHT.md).

## Catalogue and schedule

### Coming up strip

Programmes longer than 16 editorial minutes receive a live German programme
strip near their ending. Five unequal panels in the logo's red, orange, yellow,
green and blue slide in as a stack, unfold in sequence, hold for reading, fold
back together and slide left off screen. The full-width strip sits above the
bottom safe margin; programme audio continues unchanged.

The first panel shows **JETZT**, followed by **GLEICH**, **DANACH**, **SPÄTER** and
**ANSCHLIESSEND**. Titles come from the catalogue, with German season/episode
labels. The four upcoming public programmes follow the authoritative schedule,
skipping ads and hidden continuity (weather remains visible). The strip is
omitted when fewer than four future public programmes exist.

`comingUp` in `config/lkp.yaml` controls enablement, the strict duration threshold,
lead and display duration. Defaults are 16 minutes, 60 seconds before the end,
and 20 seconds on screen. Eligibility excludes embedded ads/intermissions.
For segmented programmes the strip stays in the final content/credits run; if
necessary it starts later, or is omitted when that run is too short. Restarts
resume the correct animation phase; an already finished strip is not replayed.
Text is drawn once per encoder into five finite colour sources, then moved by
the existing FFmpeg compositor. No extra media assets or schedule rows are needed.

An interactive preview with sample German titles can be created locally:

```bash
npm run coming-up:preview
# Open runtime/coming-up-preview/index.html in a browser.
```

This only writes a standalone preview page; it does not access the schedule or
start playout. Deploying the code/config and restarting production are separate
operations.

Future events may contain an immutable playout plan: content ranges, shortened
credits, WERBUNG bumper, one or two ads, an LKP intermission, and resumed content.
Only programmes longer than 35 editorial minutes qualify, and only every other
ordinary programme is eligible. Enabled low-confidence markers are accepted; timed fallback points are used
when preferred editorial markers are missing. A ready ad and a rendered bumper
are required before inserting any ad block. Existing future rows are migrated
only by an explicit backup-first operation:

```bash
npm run lkp -- schedule replan
```

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

TSDuck `eitinject` reorganizes those events into actual present/following and schedule EIT at runtime. EPG strings are bounded by DVB encoded-byte limits; longer descriptions are split across numbered extended-event descriptors. Validate the actual feed with `tstabcomp runtime/epg.xml -o /tmp/lkp-epg.bin`. A running older broadcaster can retain an invalid generator until it exits; `npm run lkp -- epg watch --until-pid BROADCAST_PID` keeps its feed valid without restarting video or RF and exits with that process.

## Automated content acquisition

The independent acquisition worker shares the authoritative catalogue, indexes
existing media first, applies bounded toddler-programme subscriptions, and ingests
manual incoming files without prompts. It uses low-priority resource limits and
regenerates only safe future scheduling without restarting playout. See
[ACQUISITION.md](ACQUISITION.md) for policy, deployment, commands and limitations.

## Advertising inventory

Advertising commands use the `ads:*` prefix, matching the other `area:action`
npm scripts. List the inventory or add one German TV spot with:

```bash
npm run ads:list
npm run ads:add -- 'https://www.youtube.com/watch?v=VIDEO_ID'
# Optional metadata:
npm run ads:add -- 'https://www.youtube.com/watch?v=VIDEO_ID' --advertiser 'Brand' --language de
# Annual Christmas window, December 1–25 inclusive in Europe/Prague:
npm run ads:add -- 'https://www.youtube.com/watch?v=VIDEO_ID' --tag christmas
```

The list includes enabled and disabled spots with IDs, durations, languages and
titles. `npm run add-ad -- URL` remains available as a compatibility alias.
Use `npm run` to see all shortcuts and `npm run ads:add -- --help` for add options.

The `christmas` tag restricts the whole spot to December 1–25 each year.
Both embedded ad breaks and children's programme fillers enforce this window,
including spots that would cross midnight into December 26. Plans retain the tag,
and playout checks the real Prague date again before playing a seasonal spot.

`yt-dlp` downloads the source and the ingest service atomically creates a
1920x1080 H.264/yuv420p 25 fps, AAC 48 kHz playout copy under the generated media
root. To ingest the six approved initial spots, use `npm run ads:bootstrap`.
The CLI automatically uses `runtime/tools/yt-dlp/bin/yt-dlp` when present, so the Pi can keep the downloader project-local without a system package installation.

For YouTube playback attestation and account authentication, use the maintained
ad downloader. It uses the `mweb`/`web_safari` clients and the upstream-listed
BgUtils PO-token provider, bound only to `127.0.0.1:4416`. Tokens stay in memory
and helper output is discarded. Install its isolated dependencies with:

```bash
LKP_DENO=/path/to/deno bash scripts/setup-youtube-ads.sh
npm run ads:add -- 'https://www.youtube.com/watch?v=VIDEO_ID'
```

Once installed, ad ingestion selects this downloader automatically.
`LKP_YT_DLP` remains an explicit override.

The same 360p–1080p selection applies to ad metadata and download, choosing the
highest available resolution before codec preference. Ads may use 360p only when
no higher resolution is available; other acquisition retains its 480p minimum.
A playback token does not supply account login. YouTube OAuth login is no longer supported
by yt-dlp; use a signed-in browser's cookies when sign-in is required.

Follow yt-dlp's [YouTube cookie export procedure](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies):
sign in in one private browser tab, navigate that tab to
`https://www.youtube.com/robots.txt`, export only YouTube cookies in Netscape
format using an extension recommended in the
[cookie FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp),
and close the private window. Save the export locally as
`runtime/youtube/cookies.txt`, mode 600; transfer it to the matching private path
on the Pi over SSH. Never paste cookies into chat, logs or Git. The downloader
automatically uses this file when present. A normal signed-in Brave profile
can also be read directly with yt-dlp's `--cookies-from-browser brave` option;
run the native Windows build for a Windows Brave profile. Private
window cookies cannot be exported that way. See the upstream
[PO-token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide).

Current Windows Brave uses app-bound (`v20`) cookie encryption, which can prevent
direct yt-dlp export even after the browser is closed. On the Windows/WSL PC,
close Brave and run `python3 scripts/export-brave-youtube.py`. This opens Brave
with a temporary local extension that uses the browser's documented cookie API
to export only `youtube.com` cookies to `runtime/youtube/cookies.txt` (mode 600).
The receiver listens only on localhost, checks a random one-use endpoint and
validates every cookie's domain. Cookie values are never printed, and extension
files are removed when the helper exits. No browser encryption setting changes.
Transfer this file privately to the Pi's matching path; do not commit it.

The four five-second bumpers use the weather/intermission character rig, cached
alignment-driven lip sync, a held prop for each presenter, original Foley, the
pale weather-stage palette and the animated channel-ident logo. Characters stay
visible throughout. Review action frames before rendering masters. Speech is
cache-only by default; TTS is only needed if a one-word voice is missing:

```bash
npm run ads:bumpers -- --stills
npm run ads:bumpers
npm run ads:bumpers -- --audio tts
# Back up and retime only future entries when replacing ident masters/durations:
npm run lkp -- schedule replan --refresh-bumpers
```

On the Pi, `bash scripts/finish-ad-bumpers-pi.sh` renders all four cached-voice
masters, validates 1080p30 H.264/AAC, refreshes future plans (with a database
backup), and writes EPG/Excel exports. Review frames are in `bumpers/review-animated-v2`;
superseded static files are removed once no current/future plans reference them. New files and
the published manifest are activated only when every render succeeds.

Ads, bumpers, intermissions, and other `lkp-*` continuity items remain in the
authoritative internal schedule but are folded into the preceding public event
in EPG and XLSX. `lkp-weather` is the explicit visible exception. Embedded ad
blocks remain inside their parent programme event.

## Export

```bash
npm run schedule:export
npm run schedule:export -- --from 2026-10-01 --to 2026-10-31 --output runtime/october.xlsx
```

Excel dates/times are real cells displayed in Prague civil time. Headers are frozen and filtered.

## Playout and diagnostics

Select the output without changing code in `config/lkp.yaml`:

```yaml
broadcast:
  mode: internet # dvb, internet, or both
```

All modes use one programme clock and one H.264 encoder. Internet output copies
that video bitstream and converts only the small MP2 audio stream to browser-safe
AAC. `dvb` and `both` require the RF acknowledgement; `internet` does not.

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

Long-running dry-run omits `--once`. At startup the service locates the stored current event, seeks by `now - startsAt`, and shows a static logo. Later scheduled boundaries receive the transition animation. Transport output is paced at the configured mux rate in every mode. The next programme or editorial segment opens and starts encoding as soon as the current piece starts, held in a bounded memory buffer until the switch. A clean EOF immediately advances the sequence without holding the final frame or reopening the same item. Known early running can replace an upcoming short intermission with a whole, season-appropriate longer published clip that fits the recovery time. Late running can use a suitable shorter whole clip. Programmes, ads and sketches are never cut for timing recovery. If none fits, the timing difference carries forward. A newly discovered shortfall may be recovered at a later intermission so an already-prepared next piece can start immediately. Prepared transport timestamps are shifted at acquisition to match the actual handoff time. Transport counters remain continuous across encoders. Live signed timing (positive lead means ahead, negative means behind), current piece and next-piece readiness update once per second in `runtime/playout-status.json`. Use `npm run lkp -- broadcast status --watch` or the authenticated player’s timing line; `/api/playout` provides JSON. Stale status is explicitly reported. Dry-runs use a separate preview status file. Each actual attempt and its initial seek/result are stored in `playback_log`.

For debugging, shift the broadcast clock into the past. Hours and minutes may be used separately or together; the stored schedule is not changed. Programme boundaries remain aligned with real playback time. A dry-run leaves the live EPG on its normal clock; an RF run shifts its generated EPG to match the replay:

```bash
npm run broadcast:start -- --dry-run --past-hours 2 --past-minutes 30 --max-seconds 15 --output runtime/past-preview.ts
```

RF is regulated spectrum. Only after checking local rules, load, transport analysis, and a shielded/short-range setup:

```bash
npm run broadcast:start -- --rf --i-understand-rf
```

Override the configured HackRF TX gain for one run (valid range: 0–30 dB):

```bash
npm run broadcast:start -- --rf --i-understand-rf --gain 16
```

The command above starts the continuous TSDuck/GNU Radio pipeline with the explicit **16 dB** override; without `--gain`, the configured default is **21 dB**. Stop with Ctrl-C. The unit keeps stable IDs and PIDs while child FFmpeg processes change at authoritative boundaries.

## systemd

The supplied units supervise playout, the authenticated local player, and public
HTTPS ingress. Generate the stream password on the host and keep it out of Git:

```bash
sudo cp deploy/lkp.env.example /etc/lkp.env
sudo cp deploy/lkp-stream.env.example /etc/lkp-stream.env
sudo chmod 600 /etc/lkp-stream.env
sudo cp deploy/systemd/lkp.service /etc/systemd/system/lkp.service
sudo cp deploy/systemd/lkp-internet.service /etc/systemd/system/lkp-internet.service
sudo cp deploy/systemd/lkp-funnel.service /etc/systemd/system/lkp-funnel.service
sudo systemctl daemon-reload
sudo systemctl enable --now lkp-internet.service lkp.service lkp-funnel.service

journalctl -u lkp.service -u lkp-internet.service -u lkp-funnel.service -f
```

The player binds only to `127.0.0.1`; Tailscale Funnel is the public TLS
boundary. HTTP Basic authentication is enforced before the HTML, schedule API,
HLS playlist, and every media segment. Review `/etc/lkp.env`, especially the RF
acknowledgement and 21 dB gain, before enabling a mode containing DVB-T. Services
restart after failure and terminate supervised children cleanly on stop. See
[`INTERNET_STREAMING.md`](INTERNET_STREAMING.md) for installation and checks.

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
  --episode /mnt/lkp-media/LKP/.generated/lkp-wetterfreunde/episodes/YYYY-MM-DD/evening-preview --still 150

# Re-render cached speech without regenerating any narration:
npm run weather:render -- \
  --episode /mnt/lkp-media/LKP/.generated/lkp-wetterfreunde/episodes/YYYY-MM-DD/evening-preview
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
  --episode /mnt/lkp-media/LKP/.generated/lkp-wetterfreunde/episodes/YYYY-MM-DD/afternoon

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

From the development workstation in this repository—not from an SSH shell on the
Pi—run the following deployer (package installation and copying cached speech can
exceed 30 seconds):

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
The installer reuses an existing browser when possible. Otherwise it prefers the
minimal Debian Chromium package rather than depending on Raspberry Pi's package
mirror, and retries transient package downloads.

Rendering uses one worker, idle CPU scheduling on cores 0–1 (the playout cores),
a one-core CPU quota, idle I/O, a 768 MB soft memory limit and a 1 GB hard limit, with
swap disabled. Radio cores 2–3 are excluded. These controls prioritize playout;
Pi render duration and broadcast stability still need to be measured together.
Do not infer a throughput guarantee from workstation timings. If rendering is
killed or a provider is unavailable, the existing schedule continues unchanged.

The cached 2200×1520 atlas replaces per-frame processing of thousands of OSM paths
without lowering output resolution. Fully opaque intro/outro scenes skip drawing
the hidden studio. Measurements on the current workstation showed that two workers
were faster than eight, so the checked-in default remains two.
`WEATHER_RENDER_CONCURRENCY` overrides this, and the Pi service always uses one.
`render-timing.json` records setup, frame rendering, encoding,
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
sidecars. When the optional DVB converter is installed, weather generation also
prepares selectable bitmap caption tracks as described in the DVB subtitle section. The
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
`assets/weather/README.md`. The maintained
[production skill](skills/lkp-show-production/SKILL.md) covers weather,
intermissions and Nacht branding.
