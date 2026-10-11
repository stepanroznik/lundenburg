#!/usr/bin/env bash
# Run interactively on the Pi once. Requests a token only: no VPN, routing,
# DNS, firewall, systemd or broadcaster changes. Never pass credentials as args.
set -euo pipefail
set +x
umask 077
if [[ ! -t 0 || ! -t 1 ]]; then
  echo 'Run this login helper directly in your Pi terminal.' >&2
  exit 1
fi
tools=/home/lundenburg/lundenburg/runtime/tools/hide-me/current
private=/home/lundenburg/lundenburg/runtime/acquisition/vpn
if [[ ! -x "$tools/hide.me" || ! -f "$tools/CA.pem" ]]; then
  echo 'The prepared Hide.me client is missing.' >&2
  exit 1
fi
if [[ -L "$private" ]]; then
  echo 'Refusing a symlink for the private token directory.' >&2
  exit 1
fi
mkdir -p "$private"
chmod 700 "$private"
temporary=$(mktemp -d "$private/.login.XXXXXXXX")
trap 'rm -rf -- "$temporary"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
echo 'Enter your Hide.me username and password below. Password typing is hidden.'
echo 'This requests a login token; it does not connect to the VPN.'
# Reviewed upstream token command does not report authentication failure via its
# exit status. Require a newly written, valid token before reporting success.
timeout --foreground 50s "$tools/hide.me" --firewall-mark 0 \
  --ca "$tools/CA.pem" --tokenFile "$temporary/accessToken.txt" \
  --rest-timeout 20s token free-de
if [[ ! -s "$temporary/accessToken.txt" ]]; then
  echo 'Login did not produce a token. Existing credentials remain unchanged.' >&2
  exit 1
fi
python3 - "$temporary/accessToken.txt" <<'PY'
import base64, pathlib, sys
try:
    if not base64.b64decode(pathlib.Path(sys.argv[1]).read_bytes(), validate=True):
        raise ValueError()
except Exception:
    print('Login returned an invalid token; it was not installed.', file=sys.stderr)
    sys.exit(1)
PY
chmod 600 "$temporary/accessToken.txt"
mv -f -- "$temporary/accessToken.txt" "$private/accessToken.txt"
echo 'Login successful. Token saved privately on the Pi. VPN remains disconnected.'
