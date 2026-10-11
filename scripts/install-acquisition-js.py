"""Install a pinned, checksum-verified Deno into the project's ignored runtime."""
import argparse
import hashlib
import io
import json
import pathlib
import platform
import re
import urllib.request
import zipfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'v2\.\d+\.\d+', args.version):
        raise SystemExit('A pinned Deno 2 release is required')
    architecture = {'aarch64': 'aarch64', 'x86_64': 'x86_64'}.get(platform.machine())
    if architecture is None:
        raise SystemExit('Unsupported acquisition runtime architecture')
    name = f'deno-{architecture}-unknown-linux-gnu.zip'
    request = urllib.request.Request(
        f'https://api.github.com/repos/denoland/deno/releases/tags/{args.version}',
        headers={'User-Agent': 'LKP-acquisition-maintenance'})
    with urllib.request.urlopen(request, timeout=30) as response:
        release = json.load(response)
    asset = next(a for a in release['assets'] if a['name'] == name)
    digest = asset.get('digest', '')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise SystemExit('Official release does not provide a SHA-256 digest')
    with urllib.request.urlopen(asset['browser_download_url'], timeout=60) as response:
        archive = response.read(100 * 1024 * 1024 + 1)
    if len(archive) > 100 * 1024 * 1024 or 'sha256:' + hashlib.sha256(archive).hexdigest() != digest:
        raise SystemExit('Deno release checksum failed')
    root = pathlib.Path(__file__).resolve().parents[1] / 'runtime/tools/deno'
    root.mkdir(parents=True, exist_ok=True)
    # Extract only the expected executable; no archive paths are trusted.
    with zipfile.ZipFile(io.BytesIO(archive)) as package:
        binary = package.read('deno')
    temporary = root / 'deno.partial'
    temporary.write_bytes(binary)
    temporary.chmod(0o755)
    temporary.replace(root / 'deno')
    (root / 'release.json').write_text(json.dumps({
        'version': args.version, 'asset': name, 'sha256': digest[7:],
    }, indent=2) + '\n')
    print(f'Installed Deno {args.version} for {architecture}; official checksum verified.')


if __name__ == '__main__':
    main()
