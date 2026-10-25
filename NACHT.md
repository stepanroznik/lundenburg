# Lundenburg Nacht

Lundenburg Nacht (LN) is the evening identity of the existing LKP station. Both profiles use the same SQLite catalogue, schedule, playout process, transport stream and EPG writer. A single Prague civil-time schedule selects LKP or LN; the evening ident begins exactly at the configured handover boundary. The DVB service identity remains the existing cached television service.

## Profile and age policy

`config/channels.yaml` defines the two identities, Europe/Prague hours, eligibility, languages, categories, logo placement, advertising policy, rotation and LN storage limits. `channels activate` enables the profiles after validating the assets and replacing a guarded future schedule tail. Weekdays switch to LN at 20:00, weekends at 21:00, and every night returns to LKP at 06:00. The window is computed from local calendar dates, including CET/CEST changes and restarts.

Show-level editorial age recommendations live in `showPolicies`. Unknown existing catalogue items remain LKP-only. LN acquisitions carry an LN-only policy unless a reviewed decision grants eligibility to both profiles. The ages in this file are recommendations for scheduling, not official FSK classifications. `Byl jednou jeden…` shows and selected family films are shared with LN; the runtime rechecks profile, age policy, programme end, and approved transition asset before opening a scheduled file.

Review and apply recommendations with `npm run lkp -- channels ratings` and `npm run lkp -- channels ratings --apply`. Applying them makes a private SQLite backup first and updates only editorial policy records; it does not retime the schedule. Manual changes can be made with `channels policy` or per-item storage pins with `channels pin`.

## Identity and rendered assets

The visual system and motion timing are documented in [NACHT-DESIGN.md](NACHT-DESIGN.md). The source mark, palette and reusable Remotion scenes live in `assets/logo/` and `src/branding/`. LKP keeps its rainbow logo and three-rotation transition. LN uses the navy, ivory and champagne identity with a static live logo; both handovers, the station ident, block intros, outro and continuity loops are full-screen pre-rendered assets.

Render masters at low priority with `npm run branding:masters`. By default, large files are written to the media drive under `.generated/ln-brand`; they are not kept in Git. Review the contact sheet and short previews before using `channels assets <masters-manifest.json>`. That command checks H.264, 1920×1080, the configured frame rate, `yuv420p`, stereo 48 kHz AAC and exact asset coverage, then atomically updates the small runtime manifest. `channels status` reports whether that inventory is ready.

## Shared schedule and EPG

The profile scheduler partitions the existing timeline at each civil-time handover. It retains the daytime planner, ads, weather and children's intermissions, while LN uses recurring blocks for Lundenburg Aktuell, Neugierig?, Unsere Heimat, Internet kaputt, Geschichte & Gesellschaft, Nachtruhe, Feierabend and Lundenburg Kino. It schedules complete items that fit, keeps Břeclav publication dates in the description, records programme genres for EPG, avoids crossing a profile boundary and fills short gaps with the approved continuity loop. Playback history, not accumulated media time, drives the current profile and fair collection rotation.

Use `channels preview --days 7` to write an isolated schedule preview without replacing the broadcast plan. `channels activate` checks the asset inventory, backs up SQLite, protects the imminent playout tail, then materializes the combined schedule and EPG. A running broadcaster must report the `channel-profiles-v1` capability before activation. Software must be loaded once before the first LN handover; later profile changes do not restart the RF or stream pipeline.

The runtime guard falls back to profile-approved continuity if an entry is missing, ineligible, has moved across the handover, or fails to open. Kids-only content cannot become an LN programme through a stale schedule entry. If a media encoder exits early, the failed item is recorded and continuity occupies the remaining committed slot.

## Acquisition and storage

`config/nacht-acquisition.yaml` extends the existing acquisition worker. It defines UnusualVideos, Kurzgesagt, Nightshift, Rational Animations, Kraut, the latest-only Břeclav bulletin, regional Mediathek searches, and manual-only sitcom/movie categories. Discovery resolves and persists each canonical YouTube channel ID. UnusualVideos numbering and Břeclav title matching are deterministic; other LN candidates use the configured existing classifier with structured validation, a bounded request budget and cached decisions. Low-confidence items stay pending review.

The active acquisition release points to the same `config/channels.yaml` as the broadcaster, so guarded catalogue or schedule regeneration uses the current profile eligibility policy.

`npm run acquisition` provides a read-only overview, including LN curation and quota blockers. Its storage checker uses one disk-usage snapshot per refresh. Numbered UnusualVideos episodes from the pinned inventory can be classified without per-video metadata requests when their duration is known; download-time checks still verify channel identity, availability and technical properties. Historical downloads continue in background and are not a prerequisite for activating the station schedule.

Use `content discover` to inventory candidates without downloading. Use `content status`, `content pending-manual`, `content history`, `content storage`, and `content quarantine` to inspect worker state. `content run` downloads and imports eligible files under the existing worker lease, drive-mount guard, resource limits, media validation and schedule regeneration. For a reviewed decision use `content override-ln <candidateId> <file>`; `content retry-ln <candidateId>` deliberately refreshes a pending, rejected or evicted candidate.

LN has an independent 150 GiB cap and reserves 80 GiB free on the filesystem. The worker counts its incoming, staging and conversion files in admission checks. Protected UnusualVideos episodes and the current municipal bulletin are never ordinary eviction candidates; latest-only replacement validates the new file before retiring the old one. Previously evicted candidates stay recorded so scans do not create a download/eviction loop. These controls do not change the children's library cap or its files.

Regional searches prioritize the Weinviertel, Marchfeld, Thayatal, March-Thaya floodplains, nearby border communities and Lower Austria. ORF/ARTE restrictions and DRM failures remain unavailable states; the worker does not bypass them. Manual film and sitcom directories are opt-in and have no automatic source subscriptions.

## Configuration and runtime state

The imported Pi configuration has profiles enabled. Rendered masters, the
validated asset manifest, SQLite schedule and EPG are stored separately from
the source tree; pulling source does not install or regenerate those artifacts.
Use `npm run lkp -- channels status` and `systemctl status lkp.service
lkp-internet.service lkp-content.timer` on the Pi to inspect current readiness
and service state. Schedule activation does not start transmission. Starting
services or enabling acquisition remains a separate operator action.
