# LKP Internet streaming

`broadcast.mode` in `config/lkp.yaml` is the only persistent output switch:

| Mode | DVB-T / HackRF | Authenticated HLS |
| --- | --- | --- |
| `dvb` | on | off |
| `internet` | off | on |
| `both` | on | on |

Playout encodes each programme once to H.264/MP2 MPEG-TS. In Internet modes a
long-lived FFmpeg process copies H.264 without re-encoding, converts MP2 audio to
AAC, and maintains a short rolling HLS window under `runtime/internet/hls`.

The Node player listens only on `127.0.0.1:8080`. It serves the live player,
current/next schedule data, the HLS playlist, and segments behind the same HTTP
Basic authentication check. Tailscale Funnel forwards public HTTPS to that
loopback listener, so no router forwarding, purchased domain, or public IPv4 is
needed.

## Host installation

Install Tailscale from its official Debian repository, then authenticate the
device and enable Funnel for the tailnet. Tailscale prints the browser URLs for
those two owner-authorized steps.

Create the secret outside the repository:

```bash
sudo install -m 600 -o root -g root deploy/lkp-stream.env.example /etc/lkp-stream.env
# Set LKP_STREAM_PASSWORD to a cryptographically random value of at least 20 characters.
```

Install `lkp.service`, `lkp-internet.service`, and `lkp-funnel.service` from
`deploy/systemd`, reload systemd, and enable all three. `lkp.target` also groups
them with the weather timer. Funnel's stable public URL is printed by
`tailscale funnel status`.

## Verification

```bash
# No credentials: player and stream must both return 401.
curl -I https://HOSTNAME/
curl -I https://HOSTNAME/hls/stream.m3u8

# Credentials: playlist and a listed segment must return 200.
curl -u lkp:PASSWORD https://HOSTNAME/hls/stream.m3u8

systemctl status lkp.service lkp-internet.service lkp-funnel.service
journalctl -u lkp.service -u lkp-internet.service -u lkp-funnel.service
```

The first version provides one browser rendition at the broadcast resolution
and bitrate. It is intended for about zero to two concurrent viewers. The media
pipeline keeps subtitle streams separate internally, but the web player does not
yet expose a subtitle selector.

## Chromecast

Open the public HTTPS player in a Cast-supported Chrome browser, sign in, and
use **Find Chromecast**. The browser and TV must be on the same local network. Allow
local network access if Chrome asks. Chrome on iOS does not support the Cast Web
Sender SDK. An unavailable browser or a missing device is explained beside the
Cast button; ordinary browser playback continues to work.

The player uses Google's Default Media Receiver, so no custom receiver account,
registration, or app ID is needed. It sends the existing H.264/AAC MPEG-TS HLS as
a live stream. Local playback stops as soon as a selected TV session begins loading;
**Pause on TV**, **Resume on TV**, and **Stop casting** control the receiver.
Stopping casting returns the browser to the live edge. Reopening the page can
rejoin an existing receiver session without restarting its video.

Chromecast does not inherit the browser's HTTP Basic credentials. An authenticated
POST to `/api/cast`, with `X-LKP-Cast: 1`, therefore issues a random, signed HLS
capability path. It lasts six hours and is invalidated by restarting
`lkp-internet.service`. Reconnect from the player after it expires. The stream
password is never embedded in a media URL, sent to the receiver, or stored in the
page. Treat a temporary Cast URL as private: anyone holding it can watch until it
expires. The player does not persist or log these URLs.

Only the signed `/cast/TOKEN/stream.m3u8` and `/cast/TOKEN/segment-N.ts` routes allow
receiver CORS and credential-free GET/HEAD requests. Relative playlist segments
retain the capability prefix. Other files, the regular HLS routes, and all
schedule/catalogue APIs still require the browser login. The issuing endpoint
does not allow CORS and rejects cross-site requests. The page's content security
policy permits Google's SDK on `https://www.gstatic.com` and the local HLS worker.

After updating the maintained TypeScript sources, run `npm run check` and
`node --import tsx --test test/internet-cast.test.ts`, then restart only
`lkp-internet.service`. The separate playout encoder and its rolling HLS output
can continue running. Verify authenticated Cast-link creation, unauthenticated
signed playlist and segment requests, and unsigned-route rejection. A physical
Chromecast playback test is still needed to confirm device discovery and TV
playback on the viewer's network.

References: [Google Cast Web Sender integration](https://developers.google.com/cast/docs/web_sender/integrate),
[supported media and CORS](https://developers.google.com/cast/docs/media), and
[supported browsers](https://developers.google.com/cast/docs/web_sender).

The **Find Chromecast** button remains visible even when background discovery
reports no receivers. It calls `CastContext.requestSession()` directly within the
click gesture, so Chrome can open its device chooser. Picker failures distinguish
cancellation, permission refusal, discovery failure and timeout. On Android, check
**Settings → Apps → Chrome → Permissions → Nearby devices** if no devices appear.
A working YouTube or Netflix app is not a reliable test of web discovery: Google
notes that those apps use specialized discovery mechanisms in its
[discovery troubleshooting guide](https://developers.google.com/cast/docs/discovery).

## Exclusive Cast playback

The browser destroys its local HLS instance, clears the video source, disables
local autoplay and playback controls, and releases local media downloads while
casting. It stays suspended throughout receiver loading, buffering, transient
unloaded status and load failures. Only ending the Cast session restores local
playback. Play events are also guarded against an accidental browser restart.

The experimental receiver seeks, automatic reload watchdog and larger MSE-first
browser buffering introduced in dd3700a have been removed following device
regressions. Native HLS is again preferred where available. Receiver playback
uses its normal live position without sender-driven seeking or reloading.

## HLS delivery hardening

The public player and Cast capability now start at `master.m3u8`. FFmpeg generates
this single-rendition master from the actual H.264/AAC streams, declaring codec
profile/level, resolution and bitrate. It references `stream.m3u8` using a relative
URI, so the signed Cast path stays attached to every request. The copied video
bitrate is provided as metadata; `-c:v copy` still preserves the encoded video.
Google recommends explicit CODECS for receiver initialization; otherwise its HLS
player defaults to H.264 Main Profile Level 3.0, unlike this channel's output.
See [Google's HLS reference](https://developers.google.com/cast/docs/media/streaming_protocols).

The configured media playlist holds 30 four-second segments (two minutes), with
another playlist's worth retained on disk for slow/retried segment downloads.
This extends available history without requesting more client buffering or
moving the normal live start. Epoch-based segment numbering avoids reusing
cached filenames after a producer restart. Existing master/segment files are
cleared on broadcast startup using the same restricted filename whitelist.

Both authenticated and signed media use asynchronous file streams with socket
backpressure, proper HEAD and byte-range responses. An open file descriptor keeps
a requested segment readable even if FFmpeg unlinks its old pathname. Cancelled
requests stop disk reads. Signed responses remain no-store; regular segments keep
their existing private 20-second cache. Playlist responses are always no-store.
The web server keeps idle HTTP connections for 30 seconds, and background schedule
polling pauses while the page is hidden and slows from two to five seconds.

These changes preserve the 1080p rendition, native-player preference and exclusive
Cast handoff. They add no receiver seeks, automatic Cast reloads or startup delay.
Activating producer options requires one restart of the existing broadcast
service; web changes require restarting the separate web service. Neither action
requires rescheduling or modifying programme assets.
