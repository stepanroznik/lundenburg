# Repository and production review — 1 November 2026

## Changes

- Raised Nacht classification from 8 to 12 requests per batch and from 60 to
  120 per UTC day. CPU quota, download rate, disk reserves and editorial
  confidence remain unchanged. Production usage advanced beyond the former
  60-request limit, and acquisition resumed.
- Added explicit Nacht quota usage, pending count and reset time to the status
  display. Generic provider availability previously obscured this separate cap.
- Hardened Nacht retention against symbolic links. A path shaped like an
  acquired episode directory could previously lead cleanup into manually
  retained media. A regression test covers linked directories and media files.
- Bounded the advertisement downloader fallback to 360–1080p, preferring the
  highest resolution, consistently with the authenticated helper. Previously
  the direct fallback could download an unnecessarily large source.
- Removed raw provider stderr/exec messages from advertisement errors because
  they can contain signed URLs or authentication arguments. A failed-downloader
  integration test verifies that diagnostics do not disclose those values.
- Removed confirmed unused imports, variables, a callback argument and an
  unnecessary stored constructor property. This includes 22 redundant React
  imports: both TypeScript and the installed Remotion bundler use the automatic
  JSX runtime. Removed one tracked Python bytecode cache; Python source remains.
  Enabled compiler checks for unused locals and parameters.
- Added reusable, read-only source and media inventory commands, and a short
  cached-speech weather-render verification command.

## Weather verification

The actual system `lkp-weather.service` invocation at 12:00 Prague time completed
with exit code 0. No edition was due at an eligible reserved boundary during
that invocation. A separate rendering check exercised the actual production
Remotion/Chromium/FFmpeg path at 25% CPU quota and encoded 60 frames of an
archived weather timeline as 1920×1080, 30 fps H.264 with AAC audio. It reused
cached speech, made no TTS request and did not publish or alter any programme.
The preceding fresh forecast check returned all four cities with `stale=false`.
The next fresh afternoon edition is prepared by the existing 14:00 user timer.
The post-deployment render verification also passed against the cleaned source,
as did the stricter TypeScript checks on the Pi.

## Media inventory

The read-only Pi audit returned SQLite `quick_check=ok`, 1,662 catalogue entries,
9,198 files, no missing enabled media and no missing future schedule references.
It skipped symbolic links rather than following them.

| Directly unreferenced category | Files | Bytes |
| --- | ---: | ---: |
| Acquisition staging | 526 | 2,601,885,295 |
| Advertisement sources/versions | 43 | 664,742,292 |
| Generated subtitle transport/cache files | 357 | 2,441,322,344 |
| Archived weather media | 31 | 2,402,204,257 |

These are review candidates, not a deletion list. Subtitle caches have computed
references, staging may support resumable downloads, and source/archive media
may be retained intentionally. No such media was deleted. The unreferenced
ivory LN logo variant is retained as artwork rather than removed automatically.

## Coverage and limits

The full test run finished with 269 tests: 260 passed, 9 skipped, no failures.
The static inventory covered 299 tracked files and 200 source/test/script files,
with no missing relative imports. All ten Python files and the maintained shell
scripts passed syntax checks.

The review includes the tracked source and script inventory, relative import and
entrypoint checks, strict TypeScript checks, the full automated test suite,
shell/Python syntax checks, actual Pi service startup and rendering, SQLite
integrity and catalogue/schedule/media references, and PC/Pi/active-release
comparisons. Dynamic worker URLs, compiled maintenance imports and systemd
entrypoints are included in the source inventory. The generic `src/ingest.ts`
enricher extension is exercised by tests but has no production caller; current
acquisition enrichment lives in `src/acquisition/enrichment.ts`. It is retained
as an extension API, not described as an active acquisition stage.

Hardware-dependent tests may be skipped when the necessary tools are absent.
Live RF/broadcast operation was not started or stopped. These checks cannot
establish hardware behavior or guarantee that every provider URL works. The
existing ČT/access retries, low-confidence editorial review and ORF placeholder
monitoring remain appropriate. Repository cleanup excludes unrelated untracked
floorplan work and all private runtime credentials and media.
