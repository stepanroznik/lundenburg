#!/usr/bin/env python3
"""Run a media downloader in an isolated Austrian WireGuard namespace.

Only the provider endpoint is reachable on the slirp interface; nftables drops
all other traffic unless it leaves through WireGuard. No host routing changes.
The parent acquisition watchdog owns the entire process group.
"""
import configparser
import ctypes
import ipaddress
import json
import os
import pathlib
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path('/home/lundenburg/lundenburg/runtime')
NETWORK = ROOT / 'tools/hide-me/network'
WG = ROOT / 'tools/jantit-wireguard/usr/bin'


def private_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise RuntimeError('Private regular file required')
    return path.read_text()


def run(args, timeout=15):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Isolated network setup failed')
    return result.stdout


def stop(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def become_subreaper():
    # Adopt orphaned yt-dlp/FFmpeg children so they cannot outlive a failed VPN.
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise RuntimeError('Could not enable child cleanup')


def stop_descendants():
    # Record process start times to avoid signalling a recycled PID.
    processes = {}
    for entry in pathlib.Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            processes[int(entry.name)] = (int(fields[1]), fields[19])
        except (OSError, ValueError, IndexError):
            continue
    descendants = set()
    parents = {os.getpid()}
    while parents:
        children = {pid for pid, (parent, _) in processes.items() if parent in parents and pid not in descendants}
        descendants.update(children)
        parents = children
    for pid in descendants:
        try:
            fields = pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
            if fields[19] == processes[pid][1]:
                os.kill(pid, signal.SIGKILL)
        except (OSError, ValueError, IndexError):
            pass


def placeholder_only(metadata, expected):
    videos = [item for item in metadata.get('formats', [])
              if isinstance(item, dict) and (item.get('height') or 0) >= 480 and item.get('vcodec') != 'none']
    if not videos or expected < 60:
        return False
    for item in videos:
        fragments = item.get('fragments')
        if not isinstance(fragments, list):
            return False
        durations = [float(fragment.get('duration') or 0) for fragment in fragments if isinstance(fragment, dict)]
        positive = [duration for duration in durations if duration > 0]
        if not positive or len(fragments) - len(positive) > 1:
            return False
        total = sum(positive)
        if total > 30 or total >= expected * .2:
            return False
    return True


def worker(job, work):
    become_subreaper()
    raw = private_file(pathlib.Path(job['configFile']))
    config = configparser.ConfigParser(interpolation=None)
    config.read_string(raw)
    if set(config.sections()) != {'Interface', 'Peer'}:
        raise RuntimeError('Unsupported configuration')
    if set(config['Interface']) != {'address', 'dns', 'privatekey'}:
        raise RuntimeError('Unsupported interface configuration')
    if not {'publickey', 'allowedips', 'endpoint'} <= set(config['Peer']) or set(config['Peer']) - {'publickey', 'allowedips', 'endpoint', 'persistentkeepalive'}:
        raise RuntimeError('Unsupported peer configuration')
    address = str(ipaddress.IPv4Interface(config['Interface']['address'].split(',')[0].strip()))
    dns = str(ipaddress.IPv4Address(config['Interface']['dns'].split(',')[0].strip()))
    endpoint = config['Peer']['endpoint'].rsplit(':', 1)
    if len(endpoint) != 2 or endpoint[0].lower() != 'at1.vpnjantit.com' or endpoint[1] != '1024':
        raise RuntimeError('Unexpected VPN endpoint')
    peers = work / 'wireguard.conf'
    peers.write_text('[Interface]\nPrivateKey = ' + config['Interface']['privatekey'] + '\n[Peer]\n' + '\n'.join(k + ' = ' + v for k, v in config['Peer'].items()) + '\n')
    run(['mount', '--make-rprivate', '/'])
    run(['mount', '-t', 'tmpfs', 'tmpfs', '/run'])
    pathlib.Path('/run/wireguard').mkdir(mode=0o700)
    resolver = work / 'resolv.conf'
    resolver.write_text('nameserver 10.0.2.3\n')
    run(['mount', '--bind', str(resolver), '/etc/resolv.conf'])
    (work / 'pid').write_text(str(os.getpid()))
    deadline = time.monotonic() + 15
    while not (work / 'ready').exists():
        if time.monotonic() > deadline:
            raise RuntimeError('Network did not start')
        time.sleep(.05)
    server = str(ipaddress.IPv4Address(socket.gethostbyname(endpoint[0])))
    routes = json.loads(run(['ip', '-j', 'route', 'show', 'default']))
    gateway = str(ipaddress.IPv4Address(routes[0]['gateway']))
    tunnel = downloader = None
    try:
        tunnel = subprocess.Popen([str(WG / 'wireguard-go'), '-f', 'lkpwg'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            if tunnel.poll() is not None:
                raise RuntimeError('WireGuard could not start')
            if pathlib.Path('/run/wireguard/lkpwg.sock').exists():
                break
            time.sleep(.1)
        run([str(WG / 'wg'), 'setconf', 'lkpwg', str(peers)])
        run(['ip', 'address', 'add', address, 'dev', 'lkpwg'])
        run(['ip', 'link', 'set', 'lkpwg', 'up'])
        run(['ip', 'route', 'add', server + '/32', 'via', gateway, 'dev', 'tap0'])
        run(['ip', 'route', 'replace', 'default', 'dev', 'lkpwg'])
        rules = work / 'nft.conf'
        rules.write_text('table inet lkp_vpn {\nchain output {\ntype filter hook output priority 0; policy drop;\noifname "lo" accept\noifname "lkpwg" accept\noifname "tap0" ip daddr ' + server + ' udp dport 1024 accept\n}\n}\n')
        run(['/usr/sbin/nft', '-f', str(rules)])
        resolver.write_text('nameserver ' + dns + '\n')
        geo = json.loads(run(['curl', '-4', '--silent', '--show-error', '--max-time', '30', 'https://ipwho.is/'], timeout=35))
        if not geo.get('success') or geo.get('country_code') != 'AT':
            raise RuntimeError('Austrian exit not verified')
        # ORF can return a successful 10-second slate even on an Austrian exit.
        # Inspect the download manifests in the same tunnel before transferring.
        metadata = run([job['downloader'], '--ignore-config', '--no-playlist', '--no-geo-bypass', '--no-warnings', '--dump-single-json', job['args'][-1]], timeout=45)
        if len(metadata) > 16 * 1024 * 1024 or placeholder_only(json.loads(metadata), float(job['expectedDurationSeconds'])):
            raise RuntimeError('Only a short placeholder is available')
        downloader = subprocess.Popen([job['downloader'], *job['args']], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        while downloader.poll() is None:
            if tunnel.poll() is not None:
                raise RuntimeError('VPN disconnected')
            time.sleep(.2)
        if tunnel.poll() is not None or downloader.returncode:
            raise RuntimeError('Downloader failed')
    finally:
        stop(downloader)
        stop(tunnel)
        stop_descendants()


def main():
    request = pathlib.Path(sys.argv[1]).resolve()
    job = json.loads(private_file(request))
    if len(sys.argv) == 5 and sys.argv[2] == '--worker':
        mapping = pathlib.Path('/proc/self/uid_map').read_text().split()
        if len(mapping) != 3 or mapping[0] != '0' or mapping[1] == '0' or mapping[2] != '1':
            raise RuntimeError('Private rootless user namespace required')
        if os.readlink('/proc/self/ns/net') == sys.argv[4]:
            raise RuntimeError('Private network namespace required')
        worker(job, pathlib.Path(sys.argv[3]))
        return
    if os.getuid() == 0:
        raise RuntimeError('Rootless execution required')
    become_subreaper()
    parent = network = None
    with tempfile.TemporaryDirectory(prefix='.jantit-', dir=pathlib.Path(job['configFile']).parent) as name:
        work = pathlib.Path(name)
        try:
            parent = subprocess.Popen(['unshare', '--user', '--map-root-user', '--net', '--mount', sys.executable, __file__, str(request), '--worker', name, os.readlink('/proc/self/ns/net')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 10
            while not (work / 'pid').exists():
                if parent.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Namespace setup failed')
                time.sleep(.05)
            pid = (work / 'pid').read_text()
            environment = dict(os.environ)
            environment['LD_LIBRARY_PATH'] = str(NETWORK / 'usr/lib/aarch64-linux-gnu')
            network = subprocess.Popen([str(NETWORK / 'usr/bin/slirp4netns'), '--configure', '--disable-host-loopback', '--mtu=1500', '--userns-path=/proc/' + pid + '/ns/user', pid, 'tap0'], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(.5)
            if network.poll() is not None:
                raise RuntimeError('Private networking failed')
            (work / 'ready').touch()
            while parent.poll() is None:
                if network.poll() is not None:
                    raise RuntimeError('Private networking disconnected')
                time.sleep(.2)
            if parent.returncode:
                raise RuntimeError('Isolated download failed')
        finally:
            stop(parent)
            stop(network)
            stop_descendants()


if __name__ == '__main__':
    os.umask(0o077)
    def interrupted(_signal, _frame):
        raise RuntimeError('Interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        main()
    except Exception:
        print('Isolated Austrian VPN download failed.', file=sys.stderr)
        raise SystemExit(1)
