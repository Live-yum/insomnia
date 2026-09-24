#!/usr/bin/env python3
"""Package an already-built, already-tested app. No downloads or credential input."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]

def main():
    platform = sys.argv[1]
    if platform not in ('windows-x64', 'linux-arm64'):
        raise SystemExit('Use windows-x64 or linux-arm64')
    version = json.loads((ROOT / 'packages/insomnia/package.json').read_text())['version']
    build = ROOT / 'packages/insomnia/dist' / ('win-unpacked' if platform == 'windows-x64' else 'linux-arm64-unpacked')
    executable = build / ('Insomnia.exe' if platform == 'windows-x64' else 'insomnia')
    if not executable.is_file() or not (build / 'resources/app.asar').is_file():
        raise RuntimeError('Missing complete packaged application')
    if platform == 'windows-x64':
        if not (build / 'insomnia.dll').is_file():
            raise RuntimeError('Windows secure wrapper must be built before packaging')
        for original in build.glob('Insomnia-origin-*.exe'):
            original.unlink()
        (build / 'Start-Insomnia-Offline.cmd').write_bytes(('@echo off\nset "INSOMNIA_DATA_PATH="\nset "INSOMNIA_OFFLINE_DATA_PATH=%~dp0data"\nif not exist "%INSOMNIA_OFFLINE_DATA_PATH%" mkdir "%INSOMNIA_OFFLINE_DATA_PATH%"\n"%~dp0Insomnia.exe" %*\n').replace('\n', '\r\n').encode())
    else:
        launcher = build / 'start-insomnia-offline.sh'
        launcher.write_text('#!/bin/sh\nset -eu\nBASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nunset INSOMNIA_DATA_PATH\nexport INSOMNIA_OFFLINE_DATA_PATH="$BASE/data"\numask 077\nmkdir -p "$INSOMNIA_OFFLINE_DATA_PATH"\nexec "$BASE/insomnia" "$@"\n')
        launcher.chmod(0o755)
    shutil.copy2(ROOT / 'docs/OFFLINE-LOCAL.md', build / 'OFFLINE-README.md')
    (build / 'BUILD-INFO.json').write_text(json.dumps({'version': version, 'platform': platform, 'commit': os.getenv('GITHUB_SHA', 'local'), 'plugins': ['insomnia-plugin-crypto@1.1.1-offline.1', 'insomnia-plugin-offline-crypto-tools@1.0.0'], 'scope': 'runtime offline; cloud features disabled; OS egress policy still required'}, indent=2) + '\n')
    out = ROOT / 'offline-dist'
    out.mkdir(exist_ok=True)
    basename = f'Insomnia-Offline-{version}-{platform}-portable'
    if platform == 'windows-x64':
        target = out / (basename + '.zip')
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for item in sorted(build.rglob('*')):
                if item.is_file(): archive.write(item, str(Path(basename) / item.relative_to(build)))
    else:
        target = out / (basename + '.tar.gz')
        def normalize(info):
            info.uid = info.gid = 0
            info.uname = info.gname = 'root'
            info.mode &= ~(stat.S_ISUID | stat.S_ISGID)
            return info
        with tarfile.open(target, 'w:gz') as archive:
            archive.add(build, arcname=basename, filter=normalize)
    with target.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    target.with_name(target.name + '.sha256').write_text(f'{digest}  {target.name}\n')
    print(target)

if __name__ == '__main__':
    main()
