# LKP intermissions — Set 1

Fifteen reusable 1080p30 shorts: the five-second channel ident, six dialogue skits, and two silent animations for each season. Characters share the weather show's SVG rig and established ElevenLabs voice profiles. Knurpsi and Sisi speak German, Schalinka Czech, and Haluschka Slovak. The ident's brand words are the explicitly requested exception. Sisi has white fur and blue irises.

## The films

| ID | Film | Season | Audio |
| --- | --- | --- | --- |
| 01 | Channel ident | All | Three established voices + original sting |
| 02 | Mýdlo | All | Exact supplied dialogue |
| 03 | Stavební povolení | All | German |
| 04 | Eine echte Wienerin | All | German |
| 05 | Brněnský drak | All | Czech / Slovak |
| 06 | Gerecht geteilt | All | German; the biscuit quality inspector |
| 07 | Soutěž v tichu | All | Czech / Slovak; a very short silence contest |
| 08 | Jarní kaluže | Spring | Original procedural Foley |
| 09 | Malá zahrádka | Spring | Original procedural Foley |
| 10 | Koupaliště Břeclav | Summer | Original procedural Foley |
| 11 | Míč na útěku | Summer | Original procedural Foley |
| 12 | Hromada listí | Autumn | Original procedural Foley |
| 13 | Papírový drak | Autumn | Original procedural Foley |
| 14 | Koulovačka | Winter | Original procedural Foley |
| 15 | Sněhulák | Winter | Original procedural Foley |

Dialogue timing comes from actual generated speech, including breathing room, comic pauses and the final logo hold. Longer dialogue therefore runs longer than the rough requested estimates. The soap lines are preserved verbatim in source, speech requests and subtitles. Silent films are 10–12 seconds and never instantiate a speech provider, even when preparing the entire set with `--audio tts`.

## Generate and review

The existing Node dependencies, Chromium/headless shell, FFmpeg and bundled Fredoka font are reused. Run from the repository root:

```bash
npm run intermissions:list
npm run intermissions:list -- --today

# Uses existing cached voice recordings; never spends credits.
npm run intermissions:prepare

# Explicitly allow ElevenLabs only for uncached voiced lines.
npm run intermissions:prepare -- --audio tts

# One skit, without paying for speech (marked as a preview):
npm run intermissions:prepare -- --audio silent --id 02-mydlo
npm run intermissions:render -- --preview --id 02-mydlo

# Check story beats, then render broadcast-size MP4s.
npm run intermissions:stills

# On the Pi, this is the one intentional final-render command. It renders,
# validates, publishes, refreshes the gallery and inserts intermissions.
npm run intermissions:finish
```

`INTERMISSION_BROWSER` selects the installed browser executable; on the workstation the compatible binary is `/home/roznik/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell`. The Pi uses its installed Chromium. `INTERMISSION_CONCURRENCY` defaults to 2.

Outputs are under `runtime/intermissions/`:

- `index.html`: browsable gallery, seasonal filters, downloads, optional original-language captions.
- `videos/*.mp4`: H.264, yuv420p, 1920×1080, 30 fps, AAC stereo at 48 kHz.
- `videos/*.json`: durations, cast, language, season and source notes.
- `videos/*.srt` / `*.vtt`: optional original-language subtitles; no burned-in captions.
- `catalogue.json`: machine-readable media inventory with meteorological season tags.
- `manifests/*.json`: precise speech timing, lip-sync cues and animation input.
- `brand/lkp-premium.svg`: standalone vector logo with embedded Fredoka font and the original rainbow L geometry.
- `brand/channel-icon.svg`: original icon.
- `stills/`: three story frames and the ending of every short.
- `SCRIPTS.md`: final dialogue and factual references.

On the Pi the self-contained generation project is `/home/lundenburg/lkp-intermissions`. It reuses `/home/lundenburg/lkp-weather/node_modules` and the existing `runtime/weather` credentials and permanent speech cache through symlinks. Credentials are read only by the speech provider, never copied into the output pack.

The library includes `seasonAt` / `eligibleSkits`, using `Europe/Prague` dates. Spring = March–May, summer = June–August, autumn = September–November, winter = December–February. After final films pass the publish checks, schedule generation inserts one after about 80% of ordinary programme boundaries. The weighted mix is 70% channel ident, 20% seasonal silent films and 10% voiced films. Insertions are deterministic, idempotent, preserve whole programmes and avoid the weather validity margin. No intermission is scheduled until the final published manifest exists.

The current complete render predates the improved logo and is deliberately
blocked from publication by the source-revision check. Run
`npm run intermissions:finish` on the Pi when ready; it is intentionally not run
as part of deployment because rendering all 15 revised films is lengthy.

## Shared characters and adding a skit

`src/characters/registry.ts` is the common identity, personality, language and voice registry. `src/characters/Character.tsx` is the common SVG rig with outfits, gaze, expressions, walking, held props and independently controlled arms. The old `src/weather/video/Character.tsx` entry point is a compatibility wrapper, preserving weather-state outfit and prop selection.

Add a typed entry to `src/intermissions/catalogue.ts`, animate its scene in `video/Silent.tsx` or `video/Voiced.tsx`, and define any Foley in `audio.ts`. The shared actor uses ElevenLabs character alignment for lip sync. Scene action follows the actual cue timestamps, so changing a line does not require hand-rebuilding all speech timing. Speech is cached using the established weather voice settings and cache keys; rendering and Foley never call ElevenLabs.

The final film is rendered to a temporary `.partial.mp4` and renamed only when encoding completes. Missing speech, credentials, or API errors stop generation; there are no automatic paid retries. Preview manifests and movies are separately named and excluded from the gallery.

## Factual edits

The expanded Brdy skit now tells the story in the dialogue: while authorities were resolving plans and land ownership, beavers dammed the water, restored the wetland and saved the state roughly 30 million Kč. The permit punchline remains. The dams developed over several years, so the dialogue avoids the misleading viral claim that the whole restoration happened overnight. References: [Nature Conservation Agency of the Czech Republic](https://brdy.aopk.gov.cz/web/en/-/beavers-save-governments-money?redirect=/web/en), [Česká televize / CHKO Brdy interview](https://ct24.ceskatelevize.cz/clanek/regiony/bobr-v-brdech-vytvoril-mokrad-usetril-statu-miliony-357585), [AOPK account quoted by iDNES](https://www.idnes.cz/plzen/zpravy/brdy-padrtsky-rybnik-bobr-hraz-projekt.A250305_841392_plzen-zpravy_vb).

Sisi's breed history, blue eyes, Wilhelm Mucke's railway employment and the 1907 first exhibition are supported by [Arche Austria](https://www.arche-austria.at/index.php?id=83). The Brno crocodile setting follows the [City of Brno legend](https://www.brno.cz/w/o-brnenskem-drakovi) and [Brno's municipal magazine, January 2013](https://cosedeje.brno.cz/documents/317111/790956/BM_1301.pdf/6d3720aa-9912-180f-ee3d-59d35fde5d73?t=1671363847174). The pool scene now reflects its Veslařská setting beside the indoor swimming hall, residential streets, planted grounds and yellow water slide; it remains a stylized illustration rather than an architectural reproduction.

## Checks

```bash
npm run check
npm test
```

Tests cover the exact soap dialogue, immutable character languages, no network use by silent films, Prague seasonal boundaries, complete casting, and real prepared speech timing. Existing weather and playout regression tests also remain applicable. The set is visually checked at multiple frames per film and the finished MP4 streams are probed after rendering.
