#!/usr/bin/env python3
"""Archive exact tested native basic bytes, then measure/verify a fresh extraction."""
import hashlib
import json
import os
from pathlib import Path
import platform as host_platform
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile

from safe_archive import extract_verified_archive

ROOT = Path(__file__).resolve().parents[2]


def read_json(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def budget_report(kind, target):
    result = subprocess.run(['node', str(ROOT / 'scripts/offline/basic-budget.cjs'), kind, str(target)],
                            cwd=ROOT, text=True, encoding='utf-8', capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return json.loads(result.stdout)


def tree_manifest(root):
    result = {}
    for file in sorted(root.rglob('*')):
        relative = file.relative_to(root).as_posix()
        if file.is_symlink():
            target = file.resolve(strict=True)
            if not target.is_relative_to(root.resolve()):
                raise RuntimeError('Escaping package link: ' + relative)
            result[relative] = {'link': os.readlink(file)}
        elif file.is_file():
            with file.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            result[relative] = {'bytes': file.stat().st_size, 'sha256': digest}
        elif not file.is_dir():
            raise RuntimeError('Unexpected package entry: ' + relative)
    return result


def main():
    target = sys.argv[1]
    if target not in ('windows-x64', 'linux-arm64'):
        raise ValueError('Use windows-x64 or linux-arm64')
    windows = target == 'windows-x64'
    resource_target = 'win32-x64' if windows else target
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    version = read_json(ROOT / 'packages/insomnia/package.json')['version']
    build = ROOT / 'packages/insomnia/dist' / ('win-unpacked' if windows else 'linux-arm64-unpacked')
    exe = build / ('Insomnia.exe' if windows else 'insomnia')
    if not exe.is_file() or not (build / 'resources/app.asar').is_file():
        raise RuntimeError('Missing native desktop')
    smoke = read_json(ROOT / 'offline-test-results/basic-smoke.json')
    if (smoke.get('edition'), smoke.get('status'), smoke.get('sourceCommit'), smoke.get('target')) != ('basic', 'passed', commit, resource_target):
        raise RuntimeError('Basic smoke evidence does not match source and target')
    for name in ('cleanProfileNoLogin', 'localProjectPersistence', 'authenticatedHmacBridge',
                 'browserReachableControlBlocked', 'realNativeLoopbackApiPassed', 'noCommunityPluginPayload'):
        if smoke.get(name) is not True:
            raise RuntimeError('Missing acceptance check: ' + name)
    with exe.open('rb') as stream:
        header = stream.read(64)
        if windows:
            if header[:2] != b'MZ':
                raise RuntimeError('Expected PE executable')
            stream.seek(struct.unpack_from('<I', header, 0x3c)[0])
            pe = stream.read(6)
            if pe[:4] != b'PE\0\0' or struct.unpack_from('<H', pe, 4)[0] != 0x8664:
                raise RuntimeError('Expected AMD64 executable')
        elif header[:4] != b'\x7fELF' or header[4:6] != b'\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 183:
            raise RuntimeError('Expected AArch64 ELF64')
    if windows:
        wrapper = read_json(ROOT / 'offline-test-results/windows-wrapper.json')
        if wrapper.get('status') != 'passed' or wrapper.get('debuggerArguments') is not False or wrapper.get('sandboxDisabled') is not False:
            raise RuntimeError('Final Windows wrapper has not passed')
        if not (build / 'insomnia.dll').is_file():
            raise RuntimeError('Missing secure wrapper payload')
        for original in build.glob('Insomnia-origin-*.exe'):
            original.unlink()
        launcher = '@echo off\nsetlocal\nset "INSOMNIA_DATA_PATH="\nset "INSOMNIA_OFFLINE_PLUGIN_DIR="\nset "INSOMNIA_OFFLINE_DATA_PATH=%~dp0data"\nif not exist "%INSOMNIA_OFFLINE_DATA_PATH%" mkdir "%INSOMNIA_OFFLINE_DATA_PATH%"\n"%~dp0Insomnia.exe" %*\n'
        (build / 'Start-Insomnia-Offline.cmd').write_bytes(launcher.replace('\n', '\r\n').encode('utf-8'))
    else:
        launcher = build / 'start-insomnia-offline.sh'
        launcher.write_text('#!/bin/sh\nset -eu\nBASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nunset INSOMNIA_DATA_PATH INSOMNIA_OFFLINE_PLUGIN_DIR\nexport INSOMNIA_OFFLINE_DATA_PATH="$BASE/data"\numask 077\nmkdir -p "$BASE/data"\nexec "$BASE/insomnia" "$@"\n', encoding='utf-8')
        launcher.chmod(0o755)
    if (build / 'data').exists():
        raise RuntimeError('Never ship a test/user profile')
    shutil.copy2(ROOT / 'docs/OFFLINE-BASIC.zh-CN.md', build / 'OFFLINE-README.zh-CN.md')
    (build / 'BUILD-INFO.json').write_text(json.dumps(smoke, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    before = budget_report('directory', build)
    manifest = tree_manifest(build)
    output = ROOT / 'offline-dist'
    output.mkdir(exist_ok=True)
    basename = f'Insomnia-Offline-{version}-basic-{target}-portable'
    archive_path = output / (basename + ('.zip' if windows else '.tar.gz'))
    if windows:
        with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for file in sorted(build.rglob('*')):
                if file.is_symlink():
                    raise RuntimeError('Unexpected Windows link')
                if file.is_file():
                    archive.write(file, str(Path(basename) / file.relative_to(build)))
    else:
        def normalize(info):
            info.uid = info.gid = 0
            info.uname = info.gname = 'root'
            info.mode &= ~(stat.S_ISUID | stat.S_ISGID)
            return info
        with tarfile.open(archive_path, 'w:gz', compresslevel=6) as archive:
            archive.add(build, arcname=basename, filter=normalize)
    archive_budget = budget_report('archive', archive_path)
    with tempfile.TemporaryDirectory(prefix='insomnia-basic-extract-') as temporary:
        started = time.perf_counter()
        extracted = extract_verified_archive(archive_path, Path(temporary), basename, manifest, windows)
        elapsed = time.perf_counter() - started
        after = budget_report('directory', extracted)
        if tree_manifest(extracted) != manifest:
            raise RuntimeError('Final downloaded-format archive changes validated application bytes')
        for field in ('fileCount', 'unpackedBytes', 'symlinkCount'):
            if after[field] != before[field]:
                raise RuntimeError('Extraction inventory mismatch: ' + field)
    with archive_path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    report = {**smoke, **after, **archive_budget, 'archive': archive_path.name, 'archiveSha256': digest,
              'freshExtractionSeconds': round(elapsed, 3), 'extractionHashVerified': True,
              'extractionEnvironment': {'os': host_platform.platform(), 'python': host_platform.python_version(),
                                        'tool': 'manifest-verified stdlib zipfile' if windows else 'manifest-verified stdlib tarfile',
                                        'disk': 'GitHub-hosted runner temporary volume; not a user-device benchmark'}}
    (output / (archive_path.name + '.sha256')).write_text(f'{digest}  {archive_path.name}\n', encoding='utf-8')
    (output / (target + '-basic-validation.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
