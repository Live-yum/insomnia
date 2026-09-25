#!/usr/bin/env python3
"""Archive the tested native desktop and complete local catalog, never fetch code."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def main():
    platform = sys.argv[1]
    if platform not in ('windows-x64', 'linux-arm64'):
        raise SystemExit('Use windows-x64 or linux-arm64')
    target_name = 'win32-x64' if platform == 'windows-x64' else platform
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    version = read_json(ROOT / 'packages/insomnia/package.json')['version']
    build = ROOT / 'packages/insomnia/dist' / ('win-unpacked' if platform == 'windows-x64' else 'linux-arm64-unpacked')
    executable = build / ('Insomnia.exe' if platform == 'windows-x64' else 'insomnia')
    if not executable.is_file() or not (build / 'resources/app.asar').is_file():
        raise RuntimeError('Missing complete native desktop')
    smoke = read_json(ROOT / 'offline-test-results/complete-smoke.json')
    resources = read_json(ROOT / 'offline-resource-integrity.json')
    for report in (smoke, resources):
        if report['sourceCommit'] != source or report['target'] != target_name:
            raise RuntimeError('Validation evidence does not match the exact source and target')
    if smoke['status'] != 'passed' or not resources['allSourceFilesPreserved']:
        raise RuntimeError('Unsuccessful validation evidence')
    for check in ('cleanProfileNoLogin', 'localProjectPersistence', 'authenticatedHmacBridge', 'browserReachableControlBlocked', 'realNativeLoopbackApiPassed'):
        if smoke.get(check) is not True:
            raise RuntimeError('Missing desktop acceptance check: ' + check)
    with executable.open('rb') as stream:
        header = stream.read(64)
        if platform == 'windows-x64':
            if header[:2] != b'MZ':
                raise RuntimeError('Expected PE executable')
            stream.seek(struct.unpack_from('<I', header, 0x3c)[0])
            pe = stream.read(6)
            if pe[:4] != b'PE\0\0' or struct.unpack_from('<H', pe, 4)[0] != 0x8664:
                raise RuntimeError('Expected x86-64 executable')
        elif header[:4] != b'\x7fELF' or header[4:6] != b'\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 183:
            raise RuntimeError('Expected little-endian AArch64 ELF64 executable')
    if platform == 'windows-x64':
        wrapper = read_json(ROOT / 'offline-test-results/windows-wrapper.json')
        if wrapper.get('status') != 'passed' or wrapper.get('debuggerArguments') is not False or wrapper.get('sandboxDisabled') is not False:
            raise RuntimeError('Released secure entrypoint was not validated')
        if not (build / 'insomnia.dll').is_file():
            raise RuntimeError('Missing Windows secure wrapper payload')
        for original in build.glob('Insomnia-origin-*.exe'):
            original.unlink()
        (build / 'Start-Insomnia-Offline.cmd').write_bytes(('@echo off\nsetlocal\nset "INSOMNIA_DATA_PATH="\nset "INSOMNIA_OFFLINE_PLUGIN_DIR="\nset "INSOMNIA_OFFLINE_DATA_PATH=%~dp0data"\nif not exist "%INSOMNIA_OFFLINE_DATA_PATH%" mkdir "%INSOMNIA_OFFLINE_DATA_PATH%"\n"%~dp0Insomnia.exe" %*\n').replace('\n', '\r\n').encode('utf-8'))
    else:
        launcher = build / 'start-insomnia-offline.sh'
        launcher.write_text('#!/bin/sh\nset -eu\nBASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nunset INSOMNIA_DATA_PATH INSOMNIA_OFFLINE_PLUGIN_DIR\nexport INSOMNIA_OFFLINE_DATA_PATH="$BASE/data"\numask 077\nmkdir -p "$BASE/data"\nexec "$BASE/insomnia" "$@"\n', encoding='utf-8')
        launcher.chmod(0o755)
    if (build / 'data').exists():
        raise RuntimeError('Portable output must not contain a test or real user profile')
    evidence = build / 'validation'
    evidence.mkdir(exist_ok=True)
    shutil.copy2(ROOT / 'offline-resource-integrity.json', evidence)
    shutil.copy2(ROOT / 'offline-test-results/complete-smoke.json', evidence)
    if platform == 'windows-x64':
        shutil.copy2(ROOT / 'offline-test-results/windows-wrapper.json', evidence)
    for name in ('REPORT.md', 'EXCEPTIONS.json', 'catalog-names.json'):
        shutil.copy2(ROOT / 'vendor/offline-plugins' / name, evidence)
    shutil.copy2(ROOT / 'docs/OFFLINE-COMPLETE.md', build / 'OFFLINE-README.md')
    shutil.copy2(ROOT / 'docs/OFFLINE-LOCAL.md', build / 'OFFLINE-BASELINE.md')
    metadata = {'version': version, 'platform': platform, 'resourceTarget': target_name, 'sourceCommit': source,
                'catalogEntries': smoke['catalogEntries'], 'materializedPlugins': smoke['materializedPlugins'],
                'reviewedBundledPlugins': smoke['reviewedBundledPlugins'],
                'resourceTreeSha256': resources['treeSha256'],
                'allCommunityPluginFunctionsVerified': False, 'securityCertification': False,
                'scope': 'Full public catalog snapshot with explicit exceptions; community plugins disabled until reviewed; cloud services not implemented locally'}
    (build / 'BUILD-INFO.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    output = ROOT / 'offline-dist'
    output.mkdir(exist_ok=True)
    basename = f'Insomnia-Offline-{version}-full-plugins-{platform}-portable'
    if platform == 'windows-x64':
        archive_path = output / (basename + '.zip')
        with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for item in sorted(build.rglob('*')):
                if item.is_symlink():
                    raise RuntimeError('Unexpected symlink in Windows portable output')
                if item.is_file():
                    archive.write(item, str(Path(basename) / item.relative_to(build)))
    else:
        archive_path = output / (basename + '.tar.gz')
        def normalize(info):
            info.uid = info.gid = 0
            info.uname = info.gname = 'root'
            info.mode &= ~(stat.S_ISUID | stat.S_ISGID)
            return info
        with tarfile.open(archive_path, 'w:gz') as archive:
            archive.add(build, arcname=basename, filter=normalize)
    with archive_path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    archive_path.with_name(archive_path.name + '.sha256').write_text(f'{digest}  {archive_path.name}\n', encoding='utf-8')
    metadata.update(archive=archive_path.name, archiveSha256=digest, archiveBytes=archive_path.stat().st_size,
                    desktopSmoke=smoke, windowsWrapper=wrapper if platform == 'windows-x64' else None)
    (output / (platform + '-validation.json')).write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in metadata.items() if k not in ('desktopSmoke', 'windowsWrapper')}, indent=2))


if __name__ == '__main__':
    main()
