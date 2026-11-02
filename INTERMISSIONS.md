# LKP intermissions — Set 1

Nineteen reusable 1080p30 shorts, including four Christmas films: the five-second channel ident, six dialogue skits, and two silent animations for each season, plus the Christmas collection. Characters share the weather show's SVG rig and established ElevenLabs voice profiles. Knurpsi and Sisi speak German, Schalinka Czech, and Haluschka Slovak. The ident's brand words are the explicitly requested exception. Sisi has white fur and blue irises.

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

`INTERMISSION_BROWSER` selects the installed browser executable. The renderer
also checks installed Chromium/Chrome and the workstation's cached Playwright
headless shell. The Pi uses its installed Chromium.
`INTERMISSION_CONCURRENCY` defaults to 2; set it to 1 on the Pi unless measured
capacity supports more, as described in the
[production skill](skills/lkp-show-production/SKILL.md).

Final outputs are under
`/mnt/lkp-media/LKP/.generated/lkp-pausenfilme/` on the mounted media drive.
Preparation manifests and the permanent speech cache remain in the installation's
local runtime directory:

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

Publication checks every film against the current source revision and rejects
missing, preview or outdated renders. When a reviewed source change requires new
masters, run `npm run intermissions:finish` on the Pi as an explicit production
operation. Code synchronization does not render or publish films.

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

## Christmas: Jeschischek

Jeschischek (Ježíšek, der Weihnachtsigel) is the fifth recurring cast member: a warm-brown hedgehog with a rounded cream face, a short snout, cream-and-gold wings, a red cape over a green coat and colourful parcels. He is kind, hardworking and a little clumsy. He speaks Czech only; the other four retain German, Czech and Slovak. His voice reuses an existing raw voice with a separate gentle Czech processing profile and the existing alignment/speech cache. Weather retains exactly its original four city presenters.

| ID | Film | Master duration | Audio |
| --- | --- | --- | --- |
| 16-christmas-presents | Jeschischek und ein Geschenk zu viel | 22 s | Procedural Foley |
| 17-christmas-fireplace | Weihnachten am Kamin | 20 s | Procedural fire/wood ambience |
| 18-christmas-letters | Briefe an Jeschischek | 93.5 s | de / cs / sk |
| 19-christmas-map | Wer bringt die Weihnachtsgeschenke? | 169.8 s | de / cs / sk |

The Christmas films use the **normal intermission library**, with annual `availability: christmas`, not the broader winter season. The shared station availability helper enforces December 1–25 inclusive in Europe/Prague, including the whole film at midnight. Scheduling, embedded breaks, recovery choices and saved-segment playout all enforce eligibility. Real-date playout checks also protect an old saved plan or a delayed event. Paid creation remains separate from the broadcaster.

There are **no fixed Christmas clock slots**. The children’s compiler prefers an unseen Christmas film at an ordinary programme boundary when it fits before the next anchor; the initial pass spaces these preferences by at least two hours using its existing persistent history. The ordinary residual filler path remains available. The general rotation prefers eligible Christmas films within the selected kind while retaining frequent idents. This is preferred seasonal rotation, not a promise of exactly four fixed daily airings. The original daily-slot proposal was superseded by the user’s request to use the normal interstitial mix.

The Europe story distinguishes regional/family customs from LKP’s fictional coordinated deliveries. Jeschischek is LKP’s hedgehog interpretation, not a claim that traditional Ježíšek is a hedgehog. Tió de Nadal stays at home: children feed and cover the log, sing and tap it, and it **poops small gifts or sweets** beneath the blanket. The dialogue explains the joke directly. Sources are attached to the catalogue entry and exported scripts. Country outlines use public-domain Natural Earth data; a local marker identifies Catalonia rather than treating all Spain as one tradition.

The approved character uses a small rounded face inset into the brown quills, a fur collar, and a wing emerging from the cape's shoulder seam. Gift attachment points are shared by the rig and packing scene. Preserve these proportions when extending the animation.

Beat sheets: presents float from a packing table onto the spines with a visible magic trail, followed by failed wingbeats, removal of the tiny parcel and sudden takeoff. The fireplace has the four friends under a blanket on a sofa and Jeschischek on a cushion, with blinking, flickering fire and twinkling lights. Letters use one room, four illustrated wishes and an envelope/drawing reveal. The map uses static gift-bringer illustrations, region highlights, a domestic Tió demonstration with three timed stick contacts and gifts emerging beneath its blanket, and a navigation star that points into a visible wardrobe. Foley follows the same locked cue timings as the action.

Prepare only missing speech, review stills, then render only missing masters:

```bash
npm run intermissions:prepare -- --audio cache --id 16-christmas-presents 17-christmas-fireplace 18-christmas-letters 19-christmas-map
node --import tsx scripts/review-intermissions.tsx 16- 17- 18- 19-
npm run intermissions:render -- --skip-existing --id 16-christmas-presents 17-christmas-fireplace 18-christmas-letters 19-christmas-map
# Publish the selected validated films while retaining existing reviewed masters:
npm run intermissions:publish -- --id 16-christmas-presents 17-christmas-fireplace 18-christmas-letters 19-christmas-map
npm run intermissions:gallery
```

Final MP4s, SRT/VTT captions and the gallery are on the external media drive under `/mnt/lkp-media/LKP/.generated/lkp-pausenfilme/`. Original multilingual captions use the existing browser/gallery track infrastructure; these intermissions do not advertise prepared DVB subtitle streams. The broadcaster never generates voices or frames. Selected publication does not regenerate or invalidate the older fifteen broadcast masters. Failed encodes are checked before replacing a master; `--skip-existing` skips audio generation and bundling entirely when all selected masters match.

For an explicitly authorized background finish on the Pi, run `node --import tsx scripts/finish-christmas.ts` detached under `nice`/`ionice`. It runs the full tests first, prepares only cached speech, renders one worker at a time, exports the gallery, preserves and synchronizes the isolated Pi source copies, and activates the existing acquisition release workflow before publishing the four seasonal entries. It waits for an older in-flight worker to finish before exposing the new library. It does not start playout or rebuild the live timetable. Source changes during the job stop publication. `runtime/christmas-production/latest.json` records the PID, stage, outputs, failures, and any remaining PC/remote synchronization requirements; each job has separate test and render logs. Re-running skips current masters.
