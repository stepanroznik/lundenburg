# Age-aware LKP programming

The children’s compiler runs inside the existing station daytime partitions.
It reuses `PlayoutPlan`, SQLite scheduling, wall-clock seeking, subtitle handling
and EIT export. Nacht keeps its existing selection and rating system.

`config/children.yaml` contains configurable **editorial audience estimates**,
not official certification ratings. Every current catalogue show and every
configured children’s acquisition subscription has a policy, including the
additional Once Upon a Time series, ABC Bär, Bing, Peppa and the weekend film.
Policies for shared Nacht-only catalogue shows do not admit them to LKP.

The initial `targetAgeYears` is 3 and `ageToleranceYears` is 1. Eligibility uses
`max(0, recommendedAgeMin - tolerance)` through `recommendedAgeMax + tolerance`,
exactly once. `maximumTargetAge` is an independent ceiling: Rachel and Josi stay
out after age 5, even with tolerance. Tom and Jerry has the less restrictive
editorial range 3–12 and a high-energy daypart penalty near bedtime. Bluey has
range 2–10, two daily premiere anchors, next-day repeats and a larger weekly target.

Policies include `schedulingPriority`, weighted `preferredDayparts`,
`preferredSlotDurationMinutes`, `targetWeeklyAirtimeMinutes`, `energyLevel`,
`nextDayRerun`, optional `excludedDayparts` and the unbuffered age range.
The configured clock defines target recurring and rerun slots; weekly airtime,
language balance, calmness and variety guide flexible selection. These are soft
objectives, not guaranteed weekly quotas. Neutral programmes do not contribute
to spoken-language percentages. Existing per-episode seasonal/recycled-content
classification and episode numbering remain in force.

Show YAML and episode YAML can each supply `children: { ...policy fields... }`.
Episode fields override show fields and configured show defaults. Scanner output
persists the resolved override in `technical.childrenPolicy`; rescanning applies
sidecar edits. Unknown new shows use cached acquisition age classifications
(toddler, preschool, older children) deterministically. Without usable age
metadata, they remain ineligible rather than being assumed preschool-safe.
No online classifier, API credential or manual approval is required by scheduling.
`children_show_policies` records show-level decisions and their provenance;
episode-specific policy stays with the asset’s technical metadata.

```bash
# Inspect all catalogue shows and their current age eligibility.
npm run lkp -- schedule ratings

# Back up SQLite, preserve the current item/history, and atomically regenerate
# future daytime programming. These are production schedule mutations.
npm run lkp -- schedule age 6
npm run lkp -- schedule age 3 --tolerance 1

# Read-only examples, including yesterday to resolve exact reruns.
node --import tsx scripts/preview-children-schedule.ts 2026-10-26 /tmp/lkp-examples
```

`children_settings` persists runtime age, tolerance and the effective safe
boundary; it takes precedence over YAML defaults on subsequent starts. An age
change stages the complete daytime replacement, validates the timeline, checks
for concurrent schedule changes, and commits settings and entries together.
Nacht entries, handovers and already published weather retain identities, times,
plans and EPG IDs. Historical logs and the currently airing programme are retained.
The SQLite `require_children_assemblies` trigger fences out schedule publication
from acquisition workers that still have the older compiler loaded. A rejected
publication rolls back their existing schedule transaction. Immutable acquisition
releases share the maintained children policy alongside station policy.
The CLI refreshes the EIT file using the existing atomic writer; the existing EPG
watcher also republishes the database timeline. A failed rebuild leaves the
previous schedule and active age intact. The runtime guard checks every assembly
source and allows the preserved airing item to finish before the new age applies.

Each assembly is a version-1 `PlayoutPlan` with an `assembly` descriptor: clock
slot, premiere date, optional original event ID for repeats, and ordered source
IDs with in/out times and multipart indices. This is stored in the existing
`playout_plan_json`, requiring no replacement schedule schema. Short episodes of
the same show can play consecutively; four Bluey episodes fit its half-hour slot.
Each content segment carries its own subtitle tracks. `playback_assembly_sources`
(schema migration 5) records all source episodes for completed-playback accounting.
Next-day repeats copy the exact original show assembly. Fillers are chosen
afresh around it so small timing differences do not accumulate. Missing or
age-incompatible sources trigger a fresh suitable block.

Programme anchors permit `boundaryToleranceSeconds` (default 5) of early or late
running. Whole short shows, explicitly all-ages approved ads with a WERBUNG ident,
and published seasonal intermissions fill the remaining time. No holding screen
or looping "Eine kleine Pause" is generated. The following programme starts
immediately if it is a few seconds early; a whole filler can finish a few seconds
late. Ads require advertising to be enabled and an available WERBUNG bumper. Enabled
entries are the curated station ad library, including older ingests without an
optional age label. Explicit unknown/incompatible age labels remain excluded.
Pods contain up to three distinct whole spots under one bumper. Seasonal windows
are checked at each spot’s actual start. No two LKP intermissions may touch,
including across clock slots, rebuild boundaries and weather publication. A
SQLite trigger also rejects stale acquisition workers that try to reintroduce them.

Nacht handovers and already committed weather boundaries remain immutable. Only
a finite published station ident may be bounded there. Programmes and ads are never truncated to hit the clock. If no eligible
programme or usable fillers exist, generation fails and preserves the existing
schedule instead of silently generating hours of a holding screen.

Longer items can be split deterministically at chapter markers or explicit manual breakpoints
only when **every** resulting part fits. Part boundaries are stable by show slot
policy; unfinished parts precede fresh episodes. Part labels and continuation
wording appear in listings. Intact long programmes can use a larger flexible
window. Weekend 19:00–21:00 permits an eligible intact film, repeated Sunday when
Saturday’s block exists. Unavailable shows receive eligible substitutions while
subsequent target starts remain within the configured tolerance.

Weather reserves 06:05, 15:00 and 18:30 five-minute windows by default. The
isolated weather installation shares station/children policies and selects these
reserved windows before generation as well as publication. Its timer runs at
05:00, 14:00 and 17:00 Prague time; the afternoon edition starts at 15:00 so a
fresh forecast fetched at 14:00 remains within its two-hour validity limit. The normal
weather generator must still produce a finished valid edition. Publication
replaces normal programmes in a matching window, fills any remaining time with
short programmes or intermissions, and retains all later programme times.
Unavailable editions leave normal programming in place. No weather is invented
or rendered by the scheduler. Change these times/durations alongside the weather
validity configuration if required.

Limits: chapter metadata cannot prove a dramatic scene boundary. The compiler
therefore defers unsegmentable long material if no intact window fits; it does
not fabricate cuts. Continuation graphics/voiceovers and thematic matching of
shorts are not generated. An insufficient library is reported as a generation failure. Scheduling creates
no masters, paid speech or additional live Pi transcoding. Approved ads can fill the space between programme assemblies; they do not
interrupt dialogue or scenes.

The full weekday examples in `examples/schedules/` were generated read-only from
the available Pi catalogue. KiKANiNCHEN is configured but currently unavailable,
so its slot is substituted. Weather windows show normal programming until an edition is published. Examples are review artifacts, not the active broadcast schedule.

Keep the original morning/evening transformation animations, their soundtracks
and full durations. Do not add static logo cards before or after them.

`config/channels.yaml` enables `avoidHandoverLogoPadding`. The news offset is a
preferred start: if no intact programme fits before it, the bulletin can follow
the evening animation immediately. Before dawn, the compiler can refit the last
few uncommitted LN blocks with up to four intact eligible programmes, preferring
calm material and using independent shorts when necessary. It retains multipart
order for narrative series and fair rotation for protected collections. The last
few seconds can use the finite animated LN ident, never a looping static card.
Handover films and profile boundaries retain their original full timings.
