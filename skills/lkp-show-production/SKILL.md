---
name: lkp-show-production
description: Design, script, voice, animate, review, render, or extend Lundenburg Kids Premium weather programmes, intermission skits, channel idents, and reusable character scenes in the existing TypeScript/Remotion production pipeline. Use for LKP character dialogue, multilingual ElevenLabs speech, silent seasonal shorts, branded graphics, maps, props, foley, storyboards, contact-sheet review, or render preparation.
---

# LKP Show Production

Create short, warm, legible LKP programmes that feel made by the same small cast and production team. Preserve the existing TypeScript/Remotion stack and shared character rig unless a concrete limitation requires a change.

## Synchronize the PC and Pi before and after implementation

For every LKP production change, first compare the PC checkout at
`/home/roznik/repositories/lundenburg`, the Pi checkout at
`/home/lundenburg/lundenburg` (`ssh lkp-pi`), and the active isolated release
resolved from `/home/lundenburg/lkp-content/current` when acquisition is involved.
Check Git revisions, dirty/untracked source, release manifests, relevant code,
configuration and tests. A matching Git revision does not prove matching features.
Pull newer features from either machine before implementation; preserve and merge
uncommitted changes. Do not blindly overwrite either checkout or deploy an older
local acquisition policy over the active one. If production-only changes exist in
compiled JavaScript, recover them into maintained, reviewed source and regression
tests before replacing that release.

After implementation, run the required checks against the merged feature set.
When deployment is authorized, back up affected code and SQLite, prepare and
validate a complete immutable release, then activate it through the existing
release workflow. Push/synchronize the merged source, tests, policy and relevant
skill changes to both the PC and Pi; verify matching feature/file manifests and
service health. Use configured Git remotes where appropriate, preserving dirty
work and keeping credentials, private runtime state, generated media and database
contents out of Git and code synchronization. Do not leave fixes only in a
compiled release or only on one machine. Report any synchronization/deployment
step that remains incomplete. Synchronization does not authorize unrelated
rendering, scheduling, or starting/stopping playout.

## Start from the current production sources

Inspect the repository before editing. Treat these files as the current source of truth when present:

- `src/characters/registry.ts` and `src/characters/types.ts` for identities, personalities, languages, voices, speeds, colours, and processing profiles.
- `src/characters/Character.tsx` for the reusable articulated SVG rig.
- `src/weather/speech.ts` for speech spelling, caching, loudness, and alignment.
- `src/weather/narration.ts`, `model.ts`, and `display.ts` for weather facts and wording.
- `src/intermissions/catalogue.ts` for skit scripts and scene metadata.
- `src/intermissions/prepare.ts` for cue timing and speech preparation.
- `src/intermissions/video/` for reusable motion, props, scenery, logo, and scene components.
- `src/intermissions/audio.ts` for deterministic foley.
- `scripts/review-intermissions.tsx` for frame sheets and visual review.

Read [characters-and-voices.md](references/characters-and-voices.md) before writing dialogue or generating speech. Read [animation-and-sound.md](references/animation-and-sound.md) before building or revising a scene. Use [production-workflow.md](references/production-workflow.md) for implementation, review, rendering, and delivery.

## Preserve the programme's purpose

Weather shows explain real local weather to children through familiar presenters. Intermissions create a brief playful reset between programmes and strengthen the channel identity. Keep the premise understandable without exposition, give each character a reason to be present, and finish every skit with the LKP logo. Use the basic ident frequently in playout.

Build humour from personality, local knowledge, or a clear visual event. If a factual story is remarkable, tell its useful substance in the scene; do not relegate the point to a tiny footnote. Verify time-sensitive or historical claims before scripting them.

## Apply these non-negotiable rules

- Keep each character in their established language unless the brief explicitly changes it.
- Preserve user-supplied dialogue exactly in the script and subtitles. Apply pronunciation spellings only at the TTS boundary.
- Silent skits must not instantiate ElevenLabs or any other speech provider. They may use locally generated foley.
- Never put credentials, tokens, or generated passwords in source control or skill files.
- Use one normalized fact model for narration, displayed values, icons, wardrobe, and map state. Do not let generated prose invent or contradict facts.
- Prefer shared characters, props, scenery, motion helpers, logo components, and speech caches over one-off copies.
- Make every physical action causal: reach, contact, grip, carry, release, impact, and reaction must happen in that order.
- Keep actors visible through occlusion when they hide behind objects; avoid unexplained disappearance, floating, or clipping through the ground.
- Animate the whole pose. Head, eyes, torso, legs, and both arms should support the action. Avoid repeated one-arm gestures and silhouettes resembling a salute.
- Let quiet beats last long enough to read. Place reactions after the triggering word or event, never before it.
- Review exact action frames before a full render. Check hands, feet, props, foreground layers, facial intent, text contrast, and the final logo.
- Separate creation from playout. Do not schedule, publish, start a broadcast, or replace a reviewed master unless the user asks for that operation.

## Acquisition quality

Prefer 1080p whenever available, with resolution taking priority over codec.
Never acquire below 480p; validate actual dimensions before ingest. Metadata
estimates and downloads must share the same selection policy. Keep original
assets until a replacement is validated and explicitly authorized. Authorized
quality repairs use `scripts/redownload-quality.mjs --replace`, preserve existing
paths/IDs and schedules, defer protected playout assets, and delete old/staged
copies only after the atomic file/database swap commits. Reserve space for both
separate download streams and their merged output; never abort a normal merge
using a one-file size estimate. Recover completed streams locally after interruption.

## Work economically

Lock scripts and pronunciation before paid TTS. Reuse cached speech and alignment whenever the full cache identity matches. Render stills or contact sheets first, then short previews, then masters. Write masters atomically so a failed render cannot overwrite the last good file.

When the user requests background rendering, detach it with a persistent log and PID or job identifier. Report the tracking location. Chat-sized preview copies must remain separate from broadcast masters.

## Judge the result as animation

Do not accept a scene because the code technically moves an object. Scrub the important frames and ask whether a child would understand what touched what, who caused the event, and how each character feels. Fix spatial relationships and pose mechanics before adding decorative motion.
