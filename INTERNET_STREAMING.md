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
