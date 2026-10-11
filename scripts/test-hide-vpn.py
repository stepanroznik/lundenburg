#!/usr/bin/env python3
"""Bounded rootless VPN availability test. Never changes host routes or DNS.

Uses an existing private token and one approved Bobo source from the catalogue.
Reads at most a tiny HTTP response, never imports media or starts services.
"""
import json
import os
import pathlib
import shlex
import signal
import sqlite3
import subprocess
import tempfile
import time

ROOT = pathlib.Path('/home/lundenburg/lundenburg/runtime')
TOOLS = ROOT / 'tools/hide-me/current'
NETWORK = ROOT / 'tools/hide-me/network'
TOKEN = ROOT / 'acquisition/vpn/accessToken.txt'


def run(args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, timeout=7, **kwargs)


def stop(process):
    if process is None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=2)
    except ProcessLookupError:
        pass


def main():
    os.umask(0o077)
    def interrupted(_signal, _frame):
        raise RuntimeError('Test interrupted.')
    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGALRM):
        signal.signal(number, interrupted)
    signal.alarm(40)
    if os.getuid() == 0:
        raise RuntimeError('Run without sudo; this test uses rootless isolation.')
    if TOKEN.is_symlink() or not TOKEN.is_file() or TOKEN.stat().st_mode & 0o077:
        raise RuntimeError('A private mode-600 login token is required.')
    with sqlite3.connect('file:/home/lundenburg/lundenburg/data/lkp.sqlite?mode=ro', uri=True) as db:
        row = db.execute("SELECT metadata_json FROM acquisition_candidates WHERE source='mediathek' AND show_id='bobo-siebenschlaefer' AND attempts>0 ORDER BY last_seen DESC LIMIT 1").fetchone()
    if not row:
        raise RuntimeError('No previously attempted approved Bobo source is available.')
    candidate = json.loads(row[0])
    url = candidate['downloadUrl']
    if not url.startswith('https://'):
        raise RuntimeError('Expected an HTTPS broadcaster URL.')
    curl = ['curl', '--silent', '--user-agent', 'node', '--location', '--range', '0-0', '--max-filesize', '1024', '--connect-timeout', '3', '--max-time', '5', '--output', '/dev/null', '--write-out', '%{http_code}', url]
    baseline = run(curl).stdout.strip()
    host_routes = run(['ip', '-j', 'route', 'show', 'table', 'all']).stdout
    host_dns = pathlib.Path('/etc/resolv.conf').read_bytes()
    host_namespace = os.readlink('/proc/self/ns/net')
    child = network = None
    result = {'show': candidate['showId'], 'title': candidate['title'], 'directHttpStatus': baseline}
    with tempfile.TemporaryDirectory(prefix='.vpn-test-', dir=TOKEN.parent) as name:
        work = pathlib.Path(name)
        resolver = work / 'resolv.conf'
        resolver.write_text('nameserver 10.0.2.3\n')
        worker = work / 'worker.sh'
        quote = shlex.quote
        worker.write_text(f'''#!/usr/bin/env bash
set -euo pipefail
test "$(readlink /proc/self/ns/net)" != {quote(host_namespace)}
mount --make-rprivate /
mount --bind {quote(str(resolver))} /etc/resolv.conf
test {quote(str(resolver))} -ef /etc/resolv.conf
printf '%s' "$$" > {quote(str(work / 'pid'))}
while [[ ! -f {quote(str(work / 'network-ready'))} ]]; do sleep 0.05; done
{quote(str(TOOLS / 'hide.me'))} --ca {quote(str(TOOLS / 'CA.pem'))} --tokenFile {quote(str(TOKEN))} --rest-timeout 8s --interface lkp-vpn -4 connect free-de > {quote(str(work / 'vpn.log'))} 2>&1 &
vpn=$!
trap 'kill "$vpn" 2>/dev/null || true; wait "$vpn" 2>/dev/null || true' EXIT
deadline=$((SECONDS+25))
while (( SECONDS < deadline )); do
  if [[ "$(ip route get 1.1.1.1 2>/dev/null || true)" == *"dev lkp-vpn"* ]]; then
    status=$({shlex.join(curl)} || true)
    if [[ "$status" != 000 && -n "$status" ]]; then printf '%s' "$status" > {quote(str(work / 'status'))}; exit 0; fi
  fi
  kill -0 "$vpn" 2>/dev/null || exit 1
  sleep 0.2
done
exit 1
''')
        environment = dict(os.environ)
        environment['LD_LIBRARY_PATH'] = str(NETWORK / 'usr/lib/aarch64-linux-gnu')
        try:
            with (work / 'worker.log').open('w') as logs, (work / 'network.log').open('w') as network_logs:
                child = subprocess.Popen(['unshare', '--user', '--map-root-user', '--net', '--mount', 'bash', str(worker)], stdin=subprocess.DEVNULL, stdout=logs, stderr=logs, start_new_session=True)
                deadline = time.monotonic() + 4
                while not (work / 'pid').exists():
                    if child.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('Private namespace setup failed.')
                    time.sleep(0.05)
                pid = (work / 'pid').read_text()
                network = subprocess.Popen([str(NETWORK / 'usr/bin/slirp4netns'), '--configure', '--disable-host-loopback', '--mtu=1500', '--userns-path=/proc/' + pid + '/ns/user', pid, 'tap0'], env=environment, stdin=subprocess.DEVNULL, stdout=network_logs, stderr=network_logs, start_new_session=True)
                time.sleep(0.5)
                if network.poll() is not None:
                    raise RuntimeError('Private network helper failed.')
                (work / 'network-ready').touch()
                child.wait(timeout=30)
                result['vpnHttpStatus'] = (work / 'status').read_text() if (work / 'status').exists() else 'unavailable'
                result['vpnConnectedForRequest'] = (work / 'status').exists()
        finally:
            signal.alarm(0)
            stop(child)
            stop(network)
    result['hostRoutesUnchanged'] = host_routes == run(['ip', '-j', 'route', 'show', 'table', 'all']).stdout
    result['hostDnsUnchanged'] = host_dns == pathlib.Path('/etc/resolv.conf').read_bytes()
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never expose provider logs, source URL query parameters or token data.
        print(json.dumps({'error': 'Isolated VPN availability test failed; no provider credentials or logs are displayed.'}))
        raise SystemExit(1)
