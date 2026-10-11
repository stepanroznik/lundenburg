#!/usr/bin/env python3
"""Run the existing Node downloader in a temporary rootless VPN namespace.

All children inherit the acquisition worker's process group and resource limits.
Killing that group also removes the namespace/tunnel. Host routes and DNS are
never changed. Only an existing token is accepted; stdin never prompts.
"""
import json
import os
import pathlib
import shlex
import signal
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path('/home/lundenburg/lundenburg/runtime')
TOOLS = ROOT / 'tools/hide-me/current'
NETWORK = ROOT / 'tools/hide-me/network'


def stop(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def main():
    os.umask(0o077)
    def interrupted(_signal, _frame):
        raise RuntimeError('Interrupted.')
    for number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(number, interrupted)
    if os.getuid() == 0:
        raise RuntimeError('Rootless execution required.')
    request = pathlib.Path(sys.argv[1]).resolve()
    job = json.loads(request.read_text())
    token = pathlib.Path(job['tokenFile'])
    if token.is_symlink() or not token.is_file() or token.stat().st_mode & 0o077:
        raise RuntimeError('Private token missing.')
    worker_path = pathlib.Path(job['worker'])
    if not worker_path.is_file() or worker_path.name != 'vpn-worker.js':
        raise RuntimeError('Prepared worker missing.')
    for field in ('connectTimeoutSeconds', 'downloadStallSeconds'):
        if not 1 <= int(job['policy'][field]) <= 3600:
            raise RuntimeError('Invalid transfer timeout.')
    namespace = os.readlink('/proc/self/ns/net')
    process = network = None
    with tempfile.TemporaryDirectory(prefix='.download-', dir=token.parent) as name:
        work = pathlib.Path(name)
        resolver = work / 'resolv.conf'
        resolver.write_text('nameserver 10.0.2.3\n')
        quote = shlex.quote
        worker = work / 'worker.sh'
        worker.write_text(f'''#!/usr/bin/env bash
set -euo pipefail
test "$(readlink /proc/self/ns/net)" != {quote(namespace)}
mount --make-rprivate /
mount --bind {quote(str(resolver))} /etc/resolv.conf
test {quote(str(resolver))} -ef /etc/resolv.conf
printf '%s' "$$" > {quote(str(work / 'pid'))}
while [[ ! -f {quote(str(work / 'ready'))} ]]; do sleep 0.05; done
{quote(str(TOOLS / 'hide.me'))} --ca {quote(str(TOOLS / 'CA.pem'))} --tokenFile {quote(str(token))} --rest-timeout 15s --interface lkp-vpn -4 connect free-de > {quote(str(work / 'vpn.log'))} 2>&1 &
vpn=$!
cleanup() {{ kill "$vpn" 2>/dev/null || true; wait "$vpn" 2>/dev/null || true; }}
trap cleanup EXIT
trap 'exit 143' TERM
deadline=$((SECONDS+30))
while (( SECONDS < deadline )); do
  kill -0 "$vpn" 2>/dev/null || exit 1
  if [[ "$(ip route get 1.1.1.1 2>/dev/null || true)" == *"dev lkp-vpn"* ]]; then
    /usr/bin/node {quote(str(worker_path))} {quote(str(request))}
    exit $?
  fi
  sleep 0.1
done
exit 1
''')
        environment = dict(os.environ)
        environment['LD_LIBRARY_PATH'] = str(NETWORK / 'usr/lib/aarch64-linux-gnu')
        try:
            with (work / 'worker.log').open('w') as logs, (work / 'network.log').open('w') as network_logs:
                # No detached sessions: the parent's acquisition process-group
                # watchdog must be able to kill every VPN/download descendant.
                process = subprocess.Popen(['unshare', '--user', '--map-root-user', '--net', '--mount', 'bash', str(worker)], stdin=subprocess.DEVNULL, stdout=logs, stderr=logs)
                deadline = time.monotonic() + 5
                while not (work / 'pid').exists():
                    if process.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('Namespace setup failed.')
                    time.sleep(0.05)
                pid = (work / 'pid').read_text()
                network = subprocess.Popen([str(NETWORK / 'usr/bin/slirp4netns'), '--configure', '--disable-host-loopback', '--mtu=1500', '--userns-path=/proc/' + pid + '/ns/user', pid, 'tap0'], env=environment, stdin=subprocess.DEVNULL, stdout=network_logs, stderr=network_logs)
                time.sleep(0.5)
                if network.poll() is not None:
                    raise RuntimeError('Private networking failed.')
                (work / 'ready').touch()
                if process.wait() != 0:
                    raise RuntimeError('Private download failed.')
        finally:
            stop(process)
            stop(network)
    print(json.dumps({'downloaded': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Provider output may contain signed URLs; never emit it or token data.
        print('Isolated VPN download failed.', file=sys.stderr)
        raise SystemExit(1)
