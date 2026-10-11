# Content acquisition on the Pi

`lkp-content` is an independent, non-interactive TypeScript worker. It shares
`/home/lundenburg/lundenburg/data/lkp.sqlite` with the programme service. The
existing `shows`, `episodes`, `media_assets`, `subtitle_tracks`,
`editorial_markers` and `media_items` remain the authoritative catalogue.
Acquisition tables contain source snapshots, episode/source identity state, cached
probes, pending manual records, run state and history. They are additive migration
3, not a second content database.

The service never controls or restarts the broadcaster. It inventories existing
ordinary library media before admitting new downloads. Bluey, Krtek and Tom and
Jerry are index-only. Existing unapproved programmes are retained, not acquired.
The explicit Czech Life series exception remains enabled. There are no generic
Večerníček, historical Sesamstraße, daily Sandmännchen or commercial mirrors.

## Deployment and first run

From this checkout, with the repository's Node version on PATH:

```bash
bash scripts/deploy-content.sh
# Prepare without attempting privileged activation:
bash scripts/deploy-content.sh --prepare-only
```

If the Pi requires a sudo password, deployment stops after preparing and checking
the release. Complete activation on the Pi:

```bash
sudo install -m 644 /home/lundenburg/lkp-content/current/lkp-content.service /home/lundenburg/lkp-content/current/lkp-content.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable lkp-content.timer
sudo systemctl restart lkp-content.timer
```

Deployment creates an isolated release below `/home/lundenburg/lkp-content`,
reuses the active installation's Node modules and yt-dlp, and copies no
credentials. The installer resolves media/database paths against the active
working copy. The timer checks the worker approximately ten seconds after
enabling and after each worker exits. Scheduled runs persist their next due
time: eligible queued work continues with the next batch, while an idle library
waits up to `idlePollSeconds` (default thirty minutes). Source discovery is also
limited to that interval. Idle checks do not scan the media drive or query
providers. Individual failed candidates retain their retry delays and other
eligible candidates continue. Resource protection failures defer the whole
worker for the idle interval. The per-run job limit remains in force. `maxRunSeconds` is a soft batch limit:
after it expires, the current episode completes download, preparation and import
before the next batch is scheduled. It does not interrupt a healthy transfer.
HTTP connections are bounded by `connectTimeoutSeconds` (default twenty), while
`downloadStallSeconds` (default 120) limits an idle network read. Deliberate
bandwidth throttling is excluded from that idle timer. The same progress policy
applies inside the isolated VPN namespace. External ČT downloads and conversions
have a file-progress watchdog instead of a total-duration deadline. Short probes,
source queries and optional metadata calls retain their individual timeouts.
Playout, lease, mount and storage protection remain active throughout an episode.
The systemd service has no wall-time cutoff; configure these application
watchdogs rather than introducing a second batch deadline in systemd.
Changing the symlink affects only the acquisition service. No RF or playout
operation is performed.

The external media drive must mount at boot. If it was previously mounted only
manually, preview and install a persistent mount on the Pi using its existing
NTFS volume UUID (shown by `lsblk -o NAME,FSTYPE,UUID,MOUNTPOINTS`):

```bash
node /home/lundenburg/lkp-content/current/install-media-mount.mjs --check YOUR_VOLUME_UUID
sudo node /home/lundenburg/lkp-content/current/install-media-mount.mjs YOUR_VOLUME_UUID
```

The helper mounts only the identified existing volume, checks for the `LKP`
library, backs up `/etc/fstab`, and adds a `nofail` boot mount. It refuses
conflicting mounts/configuration and never force-mounts, repairs or formats a
disk. It does not control the broadcaster or start a content job. The existing
timer resumes acquisition after the mount is restored.

The first acquisition job can take considerably longer than a minute. Run it on
the Pi yourself when ready; systemd applies the production resource limits:

```bash
sudo systemctl start lkp-content.service
journalctl -u lkp-content.service -n 30 --no-pager
cd /home/lundenburg/lkp-content/current
node dist/src/acquisition/main.js content status
```

Ordinary invocations:

```bash
npm run content -- status
npm run lkp -- content subscriptions
npm run lkp -- content discover
npm run lkp -- content run
npm run lkp -- content index --limit 25
npm run lkp -- content pending-manual
npm run lkp -- content history
npm run lkp -- content storage
npm run lkp -- content quarantine
```

On the Pi use `node dist/src/acquisition/main.js content ...` from the acquisition
release. `discover` performs no downloads. `index` inventories existing media without hashing it and updates scheduling
when needed. A run uses a SQLite
worker lease; a concurrent invocation defers without asking a question. A killed
worker's lease is reclaimed once its owning process has exited, or expires automatically. An interrupted prepared import recovers
from its `ingest.json` manifest.

## Policy and storage

[config/content-acquisition.yaml](config/content-acquisition.yaml) lists every
approved programme and its language, source, caps, target, priority, preferred
era/season/format, inclusion/exclusion rules, compilation and clip policy, and
replacement policy. Duration values are **seconds**; storage values are **bytes**.
The defaults reserve 100 GiB free and cap new acquisitions, staging and quarantine
at 160 GiB. Download bandwidth is 2 MiB/s; this does not select lower video
quality. Mediathek downloads prefer the supplied HD direct URL. A codec conversion
retains dimensions and frame rate and uses H.264 CRF 18; compatible H.264 media is
not transcoded. Neutral files with no audio receive a silent audio track for
both broadcast outputs, with compatible H.264 video copied unchanged. If the
admitted quality cannot fit, the item is deferred.

Budgets count all existing assets of each show, including disabled assets and
unprobed inventory. Staging, incoming stability and quarantine are outside the
ordinary scanner under `/mnt/lkp-media/LKP/.acquisition`. A missing mount fails
closed. Reservations include staging/conversion requirements and are rechecked
while downloading and converting. Storage reports include all indexed shows,
including existing programmes outside the acquisition shortlist.

Reaching a target leaves discovery active and records bounded candidates. The
`report` replacement policy reports promising replacement candidates for manual
review. It **does not delete or automatically replace existing library assets**.
Successful manual imports remove the incoming copy only after the canonical
catalogue commit and a final size/mtime check. Duplicates and ambiguous incoming
files are moved to quarantine; existing library files are retained in place.

## Sources and curation

An optional Hide.me login helper is `scripts/login-hide-vpn.sh`. The prepared
ARM64 client resides under the git-ignored `runtime/tools/hide-me/current` on the
Pi. Run the helper directly in a Pi terminal and enter credentials into the
client's prompts, never in command arguments or chat. It requests only an access
token and atomically saves it at `runtime/acquisition/vpn/accessToken.txt` with
mode 600 in a mode-700 directory. It does not connect a VPN or change routing,
DNS, firewall rules or broadcast services. VPN download fallback is not enabled
by this login step. The `vpnFallback` policy separately enables an automatic
fallback for HTTP 403 from German Mediathek sources (excluding ORF); HTTP 404,
other audio languages and ČT do not trigger it. It requires both the prepared
helper and a private token. The authenticated free German tunnel and the Node
downloader run inside temporary rootless user/network/mount namespaces, with
slirp4netns providing their outbound connection. The host's routes and DNS stay
untouched. The existing downloader retains bandwidth, staging, resume and
storage-reserve checks, while the parent retains broadcast protection and the
shared resource limits. All descendants share the watchdog's process group;
cancellation removes the tunnel. The normal catalogue import occurs only after
the download succeeds. Old German candidates marked manual after repeated
processing failures receive one new retry cycle when this fallback becomes
available. A bounded one-byte test is `scripts/test-hide-vpn.py`.

MediathekViewWeb uses a bounded, paginated [machine-readable query
API](https://gist.github.com/bagbag/a2888478d27de0e989cf777f81fb33de).
Search hits must match an approved programme topic exactly after normalization;
loose keyword hits are rejected. Titles, duration windows, include/exclude rules
and compilation flags then restrict admission. Sandmännchen is restricted to the
named best-of characters; Sesamstraße requires the preferred characters and
excludes explicit historical years. Unknown ORF children's programmes enter a
persistent discovery queue, never the downloader.

ČT monitoring reads programme identity and episode cards only beneath explicitly
approved URLs, then paginates the broadcaster’s public GraphQL episode browser
for that identity. This avoids stopping at the ten server-rendered cards. It retains title, description, duration, playability, exposed expiry text,
source identity, first/last seen and any inferred episode/season. The existing
supported yt-dlp extractor is used only for public non-DRM media. No cookies,
authentication workarounds, DRM options or geography bypass are used. Missing
formats, access restrictions and extractor failures create persistent manual
records; the same unresolved item is not repeatedly notified.

Peppa, Bing, the four compact English additions, Pingu and optional Timmy Time
use the manual route until a suitable automatic source is configured. A
subscription being manual is explicit in `content subscriptions` and
`content pending-manual`.

Duplicate checks use source item/page URL, normalized programme/title and known
season/episode, language and known composition relationships. Neutral shows use
one identity regardless of nominal audio tags. Media files are not hashed for
duplicate detection. Explicit
component metadata and compilation exclusions prevent deterministic overlaps;
material hidden inside programmes without identifying metadata cannot reliably be
recognized by these checks. There is no computer-vision claim.

## Manual incoming files

Copy complete media into:

```text
/mnt/lkp-media/LKP/.acquisition/incoming/
```

Use an approved show ID and a language declaration:

```text
peppa-wutz__de__S01E01 - Eine Pfütze.mp4
sarah-and-duck__en__S01E01 - Lots of Shallots.mkv
pat-a-mat__neutral__S01E01 - Tapety.mp4
```

`Show title - S01E01 - Episode [de].mp4` and nested show-ID folders also work.
A matching episode YAML can supply `showId`, `language`, `title`, `season`,
`episode`, `sourceDescription`, `descriptionLanguage`, `externalIds`, `markers`,
`breakpoints` and `creditsPolicy`. Otherwise embedded audio-language tags can
supply spoken language. Timmy Time requires an explicit `neutral` declaration
because only effectively speech-free editions are approved.

The worker requires unchanged size/mtime across scans and at least 120 seconds
since the last write. Files still being written are deferred. A known identity
needs no interactive catalogue editing. Unknown shows, ambiguous identity,
conflicting language, unreadable headers and duplicates are reported/quarantined. A
matching pending source episode is resolved automatically by logical identity.

## Subtitles, descriptions and editorial metadata

Cataloguing uses the shared deterministic rules in `src/catalogue.ts` for both
ordinary scans and acquisition. Show and episode titles remain separate; exact
show-name prefixes, upload labels and excess whitespace are removed. Existing
German editorial titles and synopses are retained. No AI call is needed for
cleanup or numbering. The existing optional OpenAI synopsis translation remains
bounded by `metadataRequestsPerRun`.

Every ordinary series episode gets a positive episode number. Authoritative
numbers are retained; otherwise a stable local number is allocated once per
show and stored with `technical.catalogue.episodeNumberSource: local`. New entries
append numbers; rescanning does not renumber them. Seasons are optional and are
never invented. Local numbers are excluded from external subtitle/credits
matching and source episode duplicate keys. Labels use `Folge N` or
`Staffel S · Folge N`. Declare `kind: movie` in a film's `show.yaml`; films have
neither season nor episode, even if legacy filenames contain S01E01. Duration
alone does not identify a film.

Use `npm run lkp -- media normalize` to preview the existing catalogue without
media probes, provider requests or AI costs. Add `--write` to back up SQLite and
apply the same rules to existing catalogue records, episode sidecars and future listings, preserving their times and event IDs. The database retains local
numbers across ordinary scans; newly acquired sidecars also persist their
numbering provenance. This operation does not alter schedule rows, regenerate
EPG, or restart any service. Already scheduled events keep their stored metadata.

Source and filename metadata are trusted. A brief cached ffprobe reads duration,
codec, tracks and chapters for the catalogue and scheduling. Ingestion does not
decode the full video, compare its length against the source, reject source
language declarations based on track tags, or calculate whole-file fingerprints.
Only completed downloads enter the canonical library; interrupted downloads stay
hidden as `.part`. Completed staged downloads are reused across runs. Source
duration still determines curated format selection and acquisition budgets.

Subtitle preference is embedded, exact broadcaster edition, matching sidecar,
then free SubDL lookup and optionally configured OpenSubtitles results. German, Czech and English
tracks become canonical subtitle entries with provenance. Sidecars use `.de.srt`,
`.cs.srt` or `.en.srt`. Cues must be readable, ordered and within runtime. These
checks detect gross timing errors; they do **not** prove speech-level sync, so
`syncStatus` remains `unknown`. Missing subtitles are QC warnings, not an import
failure. SubDL is configured by default but performs no external requests until
`SUBDL_API_KEY` is present in the owner-only credential file. Its free local
filename parser is used; paid AI/translation endpoints are never called. A result
must identify the right programme, season and episode, report high confidence and
a release match of at least 0.8, and supply one raw file. Season packs, ambiguous
identities and unknown archive layouts are skipped. Items without reliable
season/episode metadata retain source/sidecar subtitle handling. API requests time
out after five seconds. Local counters persist across runs and cap searches at
200 and downloads at 40 per UTC day, below the published free allowances.
OpenSubtitles remains optional and disabled by default. No fuzzy title result is
attached. Existing text-to-DVB subtitle limitations remain unchanged.

Create a free SubDL account and API key at <https://subdl.com/panel/api>. On the Pi,
edit `/home/lundenburg/lundenburg/runtime/weather/credentials.env`, preserving
existing entries, and add `SUBDL_API_KEY` with the key. Keep the file mode 600.
Never paste its contents into chat, logs or version control. No service restart
is needed: the next worker reads the key. Missing credentials, exhausted quotas,
paid-only responses and unavailable subtitles never block an import. Missing
subtitles in existing media are revisited at bounded weekly intervals; unsuccessful
lookups do not rewrite media metadata or regenerate the schedule.

Trusted embedded chapters and manual markers supply intro/recap/credits,
post-credit scenes and breakpoints. The configurable TheIntroDB adapter runs when
reliable external IDs and season/episode are present. Manual markers take
precedence. Multiple credits ranges are normalized; explicit post-credit scenes
are retained even with an open-ended credits segment. Normal long credits keep
15 seconds; short titles stay intact. Effective editorial runtime excludes credit
ranges while preserving post-credit content. Missing reliable markers remain a
QC warning and **do not cause a guessed tail cut**. Ad plans use the existing
editorial/ad scheduler, not a duplicate acquisition implementation.

German descriptions prefer authoritative source German, then a small translation
of a trustworthy synopsis using the stored OpenAI key. A factual programme/title
fallback keeps the EPG usable if translation is unavailable. Provenance records
original language/text, method, model/version and retry status. Existing good
German descriptions are retained. Missing optional enrichment is retried at a
bounded weekly interval, with at most 12 metadata requests per run. Media is
never sent to OpenAI; Responses calls use `store: false`.

## Protecting playout

The worker has one heavy job at a time. Its systemd cgroup uses idle CPU/I/O,
25% of one CPU, only cores 0–1, a 768 MiB memory ceiling, no swap, 8 MiB/s disk
reads and 4 MiB/s writes. Children also use nice 19 and idle I/O. Radio cores
2–3 remain excluded. Manual file copies are throttled to 4 MiB/s and unchanged files reuse
cached probes. Timeouts/health failures terminate the entire child process group.

A stale/late heartbeat from a live broadcaster or unready next asset defers processing.
Exited processes and reused PIDs do not keep acquisition deferred indefinitely. Current
and next heartbeat events, active playback-log events and a fifteen-minute
schedule window protect assets from media reads. Schedule regeneration preserves
that boundary and published weather, takes a rolling SQLite backup, checks for
concurrent schedule changes and atomically replaces only the future tail through
the established planner. EPG is written atomically. No broadcaster restart occurs.
Failures leave valid programming and pending regeneration in place for a later
run.

Actual RF continuity under simultaneous acquisition still requires observing a
running broadcaster on the Pi; resource limits and automated tests cannot prove
an uninterrupted RF output on their own. Do not change transmitter settings to
perform acquisition validation.

## Quiet Android phone alerts

`lkp-notifications` is an independent monitor, not part of the download job.
It reads the existing playout heartbeat, checks the configured media mount/free
space and acquisition service state, and posts small messages to ntfy.sh. It
never changes playout or the catalogue. It does not require the HDD to be mounted
to run, so a missing drive can itself be reported.

Install the ntfy Android app, allow notifications, and subscribe on `https://ntfy.sh`
to the random topic stored privately on the Pi. Public ntfy topics can be read
by anyone who knows their name; keep the random topic private. Messages contain
only generic operational information, never media URLs, credentials or logs.

After deploying the acquisition release:

```bash
cd /home/lundenburg/lkp-content/current
node dist/src/notifications/main.js setup
nano /home/lundenburg/lundenburg/runtime/notifications/settings.json
# Read the topic into the phone app; leave the JSON unchanged.
node dist/src/notifications/main.js test
sudo install -m 644 lkp-notifications.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lkp-notifications.timer
```

Private settings and delivery/incident state remain under the original active
checkout's git-ignored `runtime/notifications`, so upgrades preserve them.
No account/API key is needed. No automatic test message is sent during setup.
Every command and each monitor invocation is bounded below one minute.

Checks run once per minute; faults must persist for two minutes before one
notification, followed by one recovery notification. Brief faults and repeated
unchanged faults are silent. Simultaneous faults are combined into one message.
Failed HTTP delivery retries at most once per fifteen minutes and is marked as
notified only on success. Individual HTTP 403/404 errors, missing subtitles,
and routine manual-acquisition entries do not trigger phone notifications.
Broadcast alerts arm only after the monitor first observes a fresh running
heartbeat; preview status is ignored. This observes playout heartbeat, not actual
RF reception. The first installed monitor does not alert for a previously stopped
broadcast. For planned maintenance, mute alerts with an explicit ISO timezone:

```bash
node dist/src/notifications/main.js mute '2026-10-07T18:00:00+02:00'
node dist/src/notifications/main.js status
```

The first VPN expiry is configured as `2026-11-06T15:29:00Z` (16:29 Prague).
One reminder is sent after expiry, when Hide.me permits CAPTCHA renewal. This
is a stored-date reminder: no membership API or automatic CAPTCHA solution is
claimed. After manually renewing, update the exact expiry shown by Hide.me:

```bash
node dist/src/notifications/main.js renewed '2026-12-06T15:29:00Z'
```

Use the actual new date, not this example. The Pi must be powered and online to
send an alert; detecting total Pi/network loss requires an external monitor.

The rootless VPN download helper is shipped inside each acquisition release.
Its code and job schema upgrade together; existing running releases keep their
original helper and are not interrupted by deployment. VPN binaries, networking
tools and the private token remain in their existing runtime locations.

## Quick npm status commands on the Pi

The installer adds a stable `content` npm shortcut to the original checkout if
none exists; it uses the current deployed acquisition release and Pi policy.

```bash
cd /home/lundenburg/lundenburg
npm run content -- status
npm run content -- storage
npm run content -- subscriptions
npm run content -- history
```

`status.currentDownloads` includes the current programme/episode title, bytes
downloaded, estimated total/percentage and seconds since file progress. Source
size is an estimate, so the percentage is approximate. Status only reads metadata
and file stats; it never probes, hashes or reads media. No live worker, expired
lease, or stale partial files produce an empty current-download list. History
entries include programme IDs and episode titles alongside their processing event.
`storage` reports all existing and newly acquired episode counts per show.

Public-source metadata sometimes includes Sorbian Sandmännchen editions under
the same German programme topic. Explicit Sorbian labels are excluded at both
discovery and admission, including cached candidates. Older imports carrying
these labels are disabled in the canonical catalogue and sidecar, retained in
place for manual review, and excluded from acquisition usage. Current/protected
assets wait until safe. No media is deleted; safe future schedule regeneration
uses the existing catalogue service.
