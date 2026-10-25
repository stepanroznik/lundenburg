# Lundenburg Nacht — identity and motion

LN is the quieter evening voice of Lundenburg: curious, thoughtful and close to
home. Its identity gives documentaries, local stories and unexpected internet
humour the same clear editorial frame. The palette is restrained; the programmes
supply the variety.

## Design language

The original LN monogram is drawn as vector paths, so the on-air logo does not
depend on an installed typeface. An open crescent balances the straight letters;
two small stars provide a recognizable secondary detail. The crescent is a true
transparent cutout, suitable over light and dark programme pictures.

| Role | Colour | Use |
| --- | --- | --- |
| Ink | `#101F2C` | Primary background |
| Midnight | `#172C3E` | Subtle depth |
| Horizon | `#284657` | Low-contrast landscape atmosphere |
| Champagne | `#DDB477` | Moon, rules, accents |
| Ivory | `#F3F0E7` | Letters and programme titles |
| Dawn | `#F5E6CE` | Morning handover |

Programme titles use the bundled DejaVu Serif; supporting text uses DejaVu Sans.
Both cover German and Czech accents. Their redistribution notice is beside the
font files. LKP retains its existing Fredoka typography and colourful logo.
No font, stock-image or audio network requests are needed for rendering.

Composition uses generous space, fine horizontal rules and asymmetrical title
cards. Subtle flowing contours evoke the landscape around the Morava and Thaya;
they are abstract, not a purported map or invented local skyline. Public text is
German, with original place names preserved. Technical classifications and
internal workflow labels never appear in the films.

The standard programme bug is static and transparent. Initial proposed width is
180–220 pixels at 1080p, positioned using the existing broadcaster's safe margins
and opacity. Fullscreen idents and bumpers carry their own identity and must
suppress the live bug. LKP's three-rotation transition remains its own behaviour;
LN does not borrow it.

## Motion grammar

Smooth, finite movements settle into readable holds. No perpetual spinning,
flashing, abrupt glitch effects or unnecessary camera motion. The common motif
is an orbit: colour gathers into a circle at dusk, and opens again at dawn.
The switching boundary will mean the **first frame of the handover ident**.

| Film | Duration | Choreography |
| --- | --- | --- |
| Evening handover | 10 s | LKP contracts; coloured arcs gather and warm to gold; the orbit fills, a crescent emerges, and moves into the LN lockup. The finished identity holds. |
| Morning handover | 10 s | The LN lettering withdraws; the moon sinks behind the horizon; dawn spreads, the sun rises and rainbow arcs open; the established LKP logo assembles. |
| Station ident | 6 s | A single golden orbit resolves into the complete LN identity, followed by a quiet hold. |
| Programme intro | 4 s | A programme-specific line motif draws on; the title and subtitle arrive with a short gold rule. |
| Programme outro | 4 s | The same visual grammar closes the block with “Die Nacht geht weiter.” |

Block motifs: horizontal lines for local news and cinema; elliptical orbits for
science and history; landscape contours for regional documentaries and rest;
unequal signal bars for internet comedy. Titles remain the main focus.

The original audio signature is three soft, open notes with restrained room
reflections. Dawn lifts the register. All audio is procedurally synthesized using
the existing Foley engine; there are no borrowed recordings or paid voice calls.
The films include 48 kHz stereo AAC; the existing playout encoder supplies MP2
when producing the broadcast transport stream.

## Source and review

`src/branding/identity.ts` owns the palette, geometry, block names and durations.
`Mark.tsx` is shared by transparent SVG logos and the films. `Scene.tsx` uses the
existing LKP Logo component for both handovers; `video.tsx` registers the Remotion
composition. `audio.ts` uses the shared original sound synthesizer.

```bash
npm run branding:stills
npm run branding:preview
npm run branding:preview -- --film intro --block neugierig
# After reviewing the frames and motion, render 1080p assets on the media disk:
npm run branding:masters
```

Review images and small preview videos go to ignored `runtime/ln-brand`.
Masters default to `.generated/ln-brand/nacht-orbit-v1` on the configured media
drive. `--output PATH` selects another artifact directory. Rendering uses one
Remotion worker and validates the completed H.264/yuv420p, frame rate, duration
and 48 kHz stereo AAC output before renaming the temporary file. Neither command
changes schedules, activates assets, starts transmitters or restarts services.

Candidate manifests are explicitly marked `review`; they are not published
playout manifests. The integrated profile scheduler, eligibility policies,
acquisition controls and rollout are documented in [NACHT.md](NACHT.md).
