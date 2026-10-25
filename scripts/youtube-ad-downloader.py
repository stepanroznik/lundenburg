#!/usr/bin/env python3
"""Project-local yt-dlp with playback attestation and optional private cookies."""
import fcntl
import os
from pathlib import Path
import socket
import subprocess
import sys
import time


def main():
    root = Path(__file__).resolve().parent.parent
    tools = root / 'runtime/tools/youtube-ads'
    downloader = tools / 'venv/bin/yt-dlp'
    deno = tools / 'deno'
    provider = tools / 'bgutil-provider/server'
    if not all(p.exists() for p in (downloader, deno, provider / 'node_modules')):
        sys.exit('Run scripts/setup-youtube-ads.sh with LKP_DENO pointing to Deno 2 or newer.')

    # Only one importer starts the helper. The server holds tokens in memory;
    # its output is discarded so tokens and request details cannot enter logs.
    os.umask(0o077)
    with open(tools / 'provider.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        def listening():
            try:
                with socket.create_connection(('127.0.0.1', 4416), timeout=1):
                    return True
            except OSError:
                return False
        if not listening():
            child = subprocess.Popen(
                [str(deno), 'run', '--allow-env', '--allow-net', '--allow-ffi=.',
                 '--allow-read=.', '../src/main.ts', '--host', '127.0.0.1'],
                cwd=provider / 'node_modules', stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True, close_fds=True)
            for _ in range(60):
                if listening():
                    break
                if child.poll() is not None:
                    sys.exit('YouTube playback helper failed to start.')
                time.sleep(.5)
            else:
                child.terminate()
                sys.exit('YouTube playback helper did not become ready.')

    options = [
        '--js-runtimes', f'deno:{deno}',
        '--extractor-args', 'youtube:player_client=mweb,web_safari',
        '--format', 'bv*[height>=480][height<=1080]+ba/b[height>=480][height<=1080]',
        '--format-sort-force', '-S', 'height,vcodec:h264',
        '--limit-rate', '2M', '--no-geo-bypass', '--socket-timeout', '20',
        '--retries', '2', '--sleep-requests', '1',
    ]
    cookies = root / 'runtime/youtube/cookies.txt'
    if cookies.exists():
        if cookies.stat().st_mode & 0o077:
            sys.exit('YouTube cookie file must be private: chmod 600 runtime/youtube/cookies.txt')
        options += ['--cookies', str(cookies)]
    # One invocation keeps metadata JSON intact even when extraction fails.
    os.execv(str(downloader), [str(downloader), *sys.argv[1:], *options])


if __name__ == '__main__':
    main()
