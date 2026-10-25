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
The configured clock defines actual recurring and rerun slots; weekly airtime,
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
Exact next-day repeats copy the original programme, filler and continuity events;
missing or age-incompatible sources trigger a fresh suitable block.

All fixed boundaries are fitted without cutting arbitrary scenes. Longer items
can be split deterministically at chapter markers or explicit manual breakpoints
only when **every** resulting part fits. Part boundaries are stable by show slot
policy; unfinished parts precede fresh episodes. Part labels and continuation
wording appear in listings. Intact long programmes can use a larger flexible
window. Weekend 19:00–21:00 permits an eligible intact film, repeated Sunday when
Saturday’s block exists. Unavailable shows receive eligible substitutions while
subsequent boundaries remain fixed.

Weather reserves 06:05, 15:00 and 18:30 five-minute windows by default. The normal
weather generator must still produce a finished valid edition. Publication
replaces only a matching reserved window, retaining all later programme times;
unavailable editions leave existing station continuity. No weather is invented
or rendered by the scheduler. Change these times/durations alongside the weather
validity configuration if required.

Limits: chapter metadata cannot prove a dramatic scene boundary. The compiler
therefore defers unsegmentable long material if no intact window fits; it does
not fabricate cuts. Continuation graphics/voiceovers and thematic matching of
shorts are not generated. Existing reviewed day-continuity fills residual gaps,
which can be long with an insufficient library. No new broadcast masters, paid
speech or live Pi transcoding are introduced. The new compiler does not insert
advertising within assemblies or move fixed slots to accommodate adverts.

The full weekday examples in `examples/schedules/` were generated read-only from
the available Pi catalogue. KiKANiNCHEN is configured but currently unavailable,
so its slot is substituted. Weather windows show continuity until an edition is
published. Examples are review artifacts, not the active broadcast schedule.
