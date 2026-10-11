# Production and review workflow

## 1. Inspect and outline

Read the active registry, catalogue, rendering code, and relevant programme documentation. Confirm which lines are fixed, which facts need verification, which scenes are silent, the requested duration, and whether the request includes rendering, delivery, scheduling, or broadcast changes.

Write a beat sheet before animation. Each beat should name the actor's intent, physical action, prop contact, sound, spoken cue if any, and result. Reuse established scenery or rig controls where suitable; extract reusable behaviour when more than one scene needs it.

For factual skits, verify the central claim from reliable sources. Put the meaningful fact in the spoken scene or prominent graphic. A small optional fact card may reinforce it, but must not carry the entire story.

## 2. Prepare dialogue and timing

Keep catalogue text canonical and apply pronunciation spelling only in `speech.ts` or an equivalent provider boundary. Use cache-only mode during layout when possible. Once the text and direction are settled, synthesize only missing assets. Stop on TTS or alignment failure rather than performing uncontrolled paid retries.

Use returned audio durations and alignment for cue timing. Separate speech generation from video rendering so re-renders do not spend TTS credits. Keep secrets in ignored runtime credential files or environment variables.

## 3. Build the scene

Use the shared `Character` rig and existing world/local point helpers. Draw held props around a stable grip origin so they can transfer between a resting position and a hand without jumping. Add a new reusable rig control when a physical action cannot be expressed cleanly.

Use one normalized model for all representations of data. In weather output, the narration, value labels, icons, wardrobe, expression, ambience, and map must agree. Fixture data must remain clearly labelled as preview and must never be presented as live.

Preserve the current framework unless a change solves a demonstrated production limitation. Do not rewrite the show into another UI framework to pursue visual style.

## 4. Review cheaply before rendering

Render targeted stills and contact sheets first. Include critical grip, release, collision, occlusion, facial reaction, text, and logo frames. Inspect them at useful resolution and correct problems in this order:

1. factual or language errors;
2. physical continuity and layer order;
3. character intent and timing;
4. legibility and set accuracy;
5. decorative motion and sound polish.

Listen to each new spoken line before a full render. Pay special attention to character names, Czech and Slovak consonants and `r`, line endings, pacing, and emotional intensity. Fix a bad line independently rather than invalidating good cached speech.

## 5. Render safely

Use repository commands and documentation because scripts may evolve. Typical intermission operations are preparation, an individual render by catalogue ID, the full render set, and contact-sheet review. Weather rendering is a separate process from RF or Internet output.

Masters are 1080p30 H.264/AAC unless current programme requirements say otherwise. Render to a temporary path and rename only after validation. Preserve the previous good master if generation fails. On the Pi, default to one concurrent Remotion render unless measured capacity supports more; keep broadcast/playout as a separate service and priority domain.

When asked to leave a render in the background, detach it from the session and record:

- the PID or service/job identifier;
- the log path;
- the output directory;
- enough state to distinguish completed, failed, and still-running jobs.

Do not run a long final render when the user explicitly asks only to prepare it.

## 6. Deliver and publish separately

Keep chat previews in a temporary or explicitly preview-only directory. Compress copies with lower resolution/bitrate as needed without modifying masters or television assets.

Treat publishing and scheduling as distinct operations. Duration changes can invalidate schedule manifests, so regenerate or validate scheduling data only after final masters are approved. Start broadcast or streaming services only when the current request includes that action, and preserve whichever output modes the user specifies.

## Acceptance checklist

- The story or weather fact is understandable and accurate.
- Each voice uses the right language, pronunciation, pace, character, and loudness.
- Silent scenes cause no speech-provider access.
- Hands touch held props; feet remain grounded; gravity and occlusion make sense.
- Reactions follow their cues; pauses are long enough to read.
- Character gestures are varied, expressive, and free of accidental offensive silhouettes.
- Real settings retain recognizable geography or architecture.
- Text, symbols, snow, and white characters have sufficient contrast.
- Foley matches visible materials and is not recycled monotonously.
- The final LKP logo is present and clean.
- Contact sheets and audio have been reviewed before masters.
- Failed work cannot overwrite the last good output.
- Credentials and paid-service secrets remain outside source control.
