# Austrian VPN Jantit preflight — 1 November 2026

## Follow-up: manual CAPTCHA, Austrian tunnel, and ORF limitation

Later on 1 November, the user solved a genuine animated, multi-step hCaptcha
challenge in a fresh Chromium session and submitted the form. The challenge
showed three shapes appearing and disappearing, with one different shape; a
single still image did not capture the complete task. The provider accepted the
submission and returned a WireGuard configuration. It was saved in a private
mode-600 runtime file on the Pi, outside Git. The earlier failed attempts below
are retained as a chronological record.

A bounded rootless user/network/mount namespace on the Pi then ran the Debian
userspace WireGuard implementation over slirp4netns. It observed a WireGuard
handshake and an Austrian exit according to ipwho.is. Through this connection,
yt-dlp extracted [ABC Bär vom 17.10.2026](https://on.orf.at/video/14343415/abc-baer-vom-17102026):
782.08 seconds, 15 formats. A request for the first 2,048 bytes of an HLS media
segment returned HTTP 206 and all 2,048 bytes. Host routes and DNS matched before
and after both tests. A subsequent `yt-dlp --test` download wrote 2,494,738 bytes
to temporary storage. These successful requests were not proof of the full
episode: ffprobe showed that a later downloaded sample was exactly 10.048
seconds, the ORF placeholder. All five DASH video formats and all five HLS
playlists for that episode were 10.05 seconds, despite page metadata claiming
782.08 seconds. Two other ABC Bär episodes with durations of 838.4 and 829.88
seconds likewise supplied only 10.05-second video manifests through the tunnel.
No tested episode's full stream was obtained. Tests did not import or schedule media.

To verify the path of the actual request, the test was repeated with counters
inside the downloader's private network namespace. Its route used `lkpwg`, and
the namespace firewall allowed the underlying interface to send only encrypted
UDP to the VPN endpoint. During the download, WireGuard's receive counter rose by
3,113,024 bytes while the resulting placeholder file was 2,494,738 bytes. The
sample was again 10.048 seconds. This confirms that the tested response travelled
through the VPN rather than silently using the host's ordinary connection.

Inspection of a frame from that response showed ORF's notice that the video may
be played only in Austria for rights reasons. Two independent checks, ipwho.is
and ipapi.co, identified the tunnel exit as Austrian. This does not establish
whether ORF rejects the address because it identifies a VPN or because it uses
a different geolocation database. ORF's
[geolocation help](https://der.orf.at/orfon-hilfe/orf-on-hilfe-stories/on-hilfe-geolocation100.html)
states that VPNs can be restricted for protected videos even with an Austrian IP.
VPN Jantit's [Austrian WireGuard server listing](https://www.vpnjantit.com/free-wireguard-austria)
showed only the already-tested `at1` free server when reviewed.

The test was repeated with a namespace-local nftables output policy: traffic
was permitted through the WireGuard interface and encrypted UDP to the resolved
VPN endpoint, and other outbound traffic was dropped. After the WireGuard
process was terminated, a request from the namespace failed; host routes and
DNS again matched their starting state. This establishes the behavior of the
temporary test setup, not a deployed production kill switch. A later synthetic
failure test found and corrected an orphaned downloader-child leak; the repeated
test confirmed the child had started and was terminated after tunnel failure.

This confirms Austrian connectivity and bounded ORF placeholder reads, not a full
episode download, production fail-closed behavior or automated renewal. The
user solved the challenge; no programmatic CAPTCHA solution or replacement
credential has been verified. The later acquisition implementation is documented
in [ACQUISITION.md](../ACQUISITION.md).

## Earlier preflight

The earlier preflight ended before a configuration was obtained. Its record
below is retained to distinguish the unsuccessful automated attempts from the
later successful user-assisted registration and tunnel test.

## Source and production comparison

- PC and Pi checkout: `9ecd2da`; source manifests for `src`, `test`, `scripts`,
  `skills` and `config` matched. The PC's unrelated untracked floorplan folders
  were preserved. Fetching the configured remote found no newer branch commits.
- Active acquisition release: `/home/lundenburg/lkp-content/releases/20261101T110842Z`.
  Every compiled JavaScript file matched the corresponding Pi checkout build.
- Active acquisition policy differed only in resolved runtime/helper paths.
  Nacht acquisition policy matched. `acquisition-sources.yaml` was absent from
  the release; it was not overwritten or synthesized.
- `lkp-content.service` was in its normal oneshot `activating/start` state
  before and after the experiment. No services were restarted or activated.
- `lkp.service` was inactive before and after the experiment. The saved playout
  heartbeat was dated 25 October and its recorded process was dead. Consequently
  uninterrupted **live DVB-T transmission was not testable**.
- No VPN was connected. Host routes, DNS, firewall rules, scheduling, catalogue,
  active credentials and media were not modified by this experiment.

## Live provider findings

The [Austrian account creation page](https://www.vpnjantit.com/create-free-account?server=at1&type=WireGuard)
offered `at1.vpnjantit.com`, UDP port 1024, Vienna, one device and **four days**
of validity during the browser test. Search-indexed descriptions gave different
validity periods. Renewal must use a returned credential expiry, not a hardcoded
six-day assumption. No returned credential expiry was available in this test.

The public free WireGuard form requested a username and supplied a hidden
password field. No separate website registration or login was needed to reach
the form. A rejected submission established a maximum username length of
14 characters. Whether free VPN credentials can be extended, associated with an
existing website account or replaced unattended remains unverified. No documented
free provisioning/renewal API was identified in the pages reviewed; this is not
proof that none exists.

The [provider terms](https://www.vpnjantit.com/terms-and-service) distinguish
website accounts and restrict a user to two website registrations. None were
created during this experiment. The public free-credential form must not be
interpreted as permission for unlimited registrations or credential generation.

## CAPTCHA experiment and attempt record

Browser inspection used a temporary Playwright Core installation outside the
repository and a fresh temporary Chromium context per session. No project
dependency was added. Four browser sessions loaded the page: one initial
read-only inspection, one challenge observation, and two interactive sessions.
Only **one account-creation POST** was sent; **zero VPN credentials** were created.

| Interaction | Actual observation | Result |
| --- | --- | --- |
| Initial public HTML and browser inspection | Explicit hCaptcha widget in the form | Detection confirmed; no account submitted |
| First checkbox interaction | “Drag the matching shape into place” | Observed only; session closed to add drag support to the temporary driver |
| Interactive drag challenge | Two shape pieces were moved into matching outlines and Verify was clicked | `hcaptcha.getResponse()` became nonempty; token value was neither printed nor committed |
| Account submission following that challenge | Provider rejected the generated username for exceeding 14 characters | No config returned; complete registration success **not** established |
| Response to that submission | Replacement form contained `cf-turnstile-response` | Turnstile detection confirmed; its successful verification was not established |
| Corrected-length browser session | Two-step “Please click on the icon that is different” visual challenge | Browser clicks and submission did not produce a verification token |
| One normal challenge refresh in the same session | Another two-step icon challenge | No verification token; live attempts ended |

The rejected username was corrected to a 13-character generator in the temporary
driver, but no subsequent account POST was made because verification did not
succeed. There was no loop of account registrations, service-limit exhaustion,
paid solver, challenge token injection or test-key substitution.

The conversational vision-capable agent interpreted screenshots and directed
browser mouse actions. This demonstrated one accepted drag-challenge token,
**not an unattended LLM API solver**, reliable multi-step support or a completed
VPN provisioning workflow. The icon interactions failed. No claim of production
CAPTCHA support is justified by these results.

[hCaptcha documents test keys](https://docs.hcaptcha.com/#test-your-integration)
for an integration controlled by its developer. Those keys do not establish
successful verification on VPN Jantit's production backend. No provider-specific
test environment was found in the reviewed flow. Captured screenshots, HTML and
browser data stayed outside Git; all temporary browser drivers and their
descendants were terminated after testing.

## Earlier architecture assessment

The maintained acquisition worker currently has an optional Hide.me fallback
for HTTP 403 from German Mediathek downloads and explicitly excludes ORF. Its
helper uses rootless user/network/mount namespaces with slirp4netns; only the
download worker enters the namespace. Metadata discovery, APIs and ordinary
acquisition stay outside it. That architecture is a suitable starting point,
but it is not an existing Austrian WireGuard provider abstraction.

The existing helper checks the tunnel route before starting its download. That
check alone must not be presented as a verified disconnection kill switch for a
new provider. A WireGuard implementation would require persistent fail-closed
egress rules, namespace DNS routing and loss-of-tunnel tests, including media
segment requests. The Pi did not have a `wg` command on PATH. No networking
packages or host network configuration were installed or changed.

The subsequent tunnel test verified the exit country but did not obtain a full
ABC Bär stream. Full-stream verification is required before enabling the new
fallback. Candidate configs must be validated before atomic activation; downloads
must retain their leased generation, and failed or overlapping renewals must
leave the active config intact. Provider HTML/config content must never be
executed as shell hooks.

## Acceptance and remaining deliverables

| Requested acceptance test | Status |
| --- | --- |
| Austrian WireGuard connection from Pi | Passed in a temporary rootless namespace |
| ABC Bär allowed through ORF ON | Failed for three episodes: Austrian tunnel returned only 10-second placeholders |
| Non-VPN traffic unchanged with tunnel active | Host routes and DNS unchanged; a simultaneous traffic test was not performed |
| Automatic renewal/replacement | Not implemented or verified |
| Expired-credential recovery | Not implemented or verified |
| Reproducible CAPTCHA detection/handling fixtures | Not implemented; no simulated coverage claimed |
| Genuine CAPTCHA testing | Drag token accepted, agent icon attempts failed; user solved an animated icon challenge and provisioning succeeded |
| Failed renewal preserves active configuration | Not tested; existing credentials were untouched |
| Disconnect kill switch | Temporary namespace firewall blocked a request after tunnel termination; the acquisition helper uses the same firewall policy |
| Uninterrupted DVB-T throughout testing | Not verifiable: broadcast was already stopped |

There is **no hands-off renewal capability** delivered by this preflight. A
dedicated CAPTCHA abstraction, reproducible CAPTCHA fixtures and an automatic
credential manager remain outstanding. The acquisition fallback and its release
packaging were implemented, but the fallback is disabled and the release was not
activated because the ORF full-stream prerequisite was not met. This report is an
experimental record, not a deployment-completion report.
