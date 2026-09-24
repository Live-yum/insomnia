#!/usr/bin/env python3
"""Copy inert, already materialized plugin resources without packager glob pruning.

Never imports plugins or runs lifecycle scripts. Every source file, including dot
files, licenses and transitive package manifests, must survive byte-for-byte.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'packages/insomnia'


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory(directory: Path) -> dict:
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('Resource root must be a real directory: ' + str(directory))
    result = {}
    for current, directories, files in os.walk(directory, followlinks=False):
        for name in directories + files:
            path = Path(current) / name
            mode = path.lstat().st_mode
            if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise ValueError('Non-regular resource: ' + str(path))
        for name in sorted(files):
            path = Path(current) / name
            relative = path.relative_to(directory).as_posix()
            result[relative] = {'sha256': digest(path), 'bytes': path.stat().st_size}
    return result


def synchronize(source: Path, destination: Path) -> dict:
    if source.resolve() == destination.resolve() or source.resolve() in destination.resolve().parents:
        raise ValueError('Resource source and destination must be separate trees')
    expected = inventory(source)
    if not expected:
        raise ValueError('Refusing to stage an empty resource tree')
    destination.mkdir(parents=True, exist_ok=True)
    before = inventory(destination)
    extra = set(before) - set(expected)
    if extra:
        raise ValueError('Unexpected packaged resources: ' + repr(sorted(extra)[:20]))
    changed = sorted(name for name in expected if before.get(name) != expected[name])
    for name in changed:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / name, target)
    actual = inventory(destination)
    if actual != expected:
        raise ValueError('Packaged resources differ from the reviewed local source')
    encoded = json.dumps(expected, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return {'files': len(expected), 'bytes': sum(item['bytes'] for item in expected.values()),
            'treeSha256': hashlib.sha256(encoded).hexdigest(), 'repairedFiles': changed,
            'allSourceFilesPreserved': True, 'pluginCodeExecuted': False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--target', choices=['win32-x64', 'linux-arm64'], required=True)
    args = parser.parse_args()
    directory = args.directory.absolute()
    expected_directory = APP / 'dist' / ('win-unpacked' if args.target == 'win32-x64' else 'linux-arm64-unpacked')
    if directory.resolve() != expected_directory.resolve() or not directory.is_dir():
        raise ValueError('Only the matching unpacked native output may be modified')
    destination = directory / 'resources/offline-plugins'
    for parent in [directory, directory / 'resources', destination]:
        if parent.is_symlink():
            raise ValueError('Symlink in packaged resource destination')
    source = APP / 'offline-plugin-resources'
    catalog = json.loads((source / 'catalog.json').read_text(encoding='utf-8'))
    manifest = json.loads((ROOT / 'vendor/offline-plugins/manifest.json').read_text(encoding='utf-8'))
    if catalog['target'] != args.target or catalog['sourceSha256'] != manifest['sourceSha256']:
        raise ValueError('Resource catalog source or architecture mismatch')
    by_name = {entry['name']: entry for entry in catalog['entries']}
    if len(by_name) != len(catalog['entries']) or set(by_name) != {entry['name'] for entry in manifest['entries']}:
        raise ValueError('Resource catalog must account for every snapshot entry exactly once')
    prepared = []
    for original in manifest['entries']:
        entry = by_name[original['name']]
        if original['status'] != 'dependency-complete-unreviewed':
            continue
        if entry['status'] != 'materialized-unreviewed' or not re.fullmatch(r'[0-9a-f]{20}', entry['profile']):
            raise ValueError('Incomplete local materialization: ' + entry['name'])
        package_file = source / entry['profile'] / 'node_modules' / entry['name'] / 'package.json'
        info = json.loads(package_file.read_text(encoding='utf-8'))
        if info.get('name') != original['name'] or info.get('version') != original['version']:
            raise ValueError('Materialized root package identity mismatch: ' + original['name'])
        prepared.append(entry['name'])
    report = synchronize(source, destination)
    report.update(target=args.target, catalogEntries=len(by_name), materializedPlugins=len(prepared),
                  sourceCommit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip())
    (ROOT / 'offline-resource-integrity.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'repairedFiles'}, indent=2))
    print('Restored omitted or changed resource files:', len(report['repairedFiles']))


if __name__ == '__main__':
    main()
