#!/usr/bin/env python3
"""Preserve test diagnostics in a ZIP whose member names work on every platform.

Test titles are untrusted filenames, not executable content. Never follow links,
modify test output, upload credentials, or infer that a test passed from a trace.
Only the explicitly supplied Playwright output directory is read.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import zipfile


def member_name(index: int, name: str) -> str:
    label = re.sub(r'[^A-Za-z0-9._-]', '_', name)[:100].rstrip('. ')
    return f'files/{index:06d}-{label or "diagnostic"}'


def collect(source: Path, output: Path) -> dict:
    if source.is_symlink() or not source.is_dir():
        raise ValueError('Expected a real Playwright output directory')
    source = source.resolve()
    output = output.absolute()
    if output.resolve().is_relative_to(source):
        raise ValueError('The diagnostic archive must be outside the source directory')
    if output.exists() or output.is_symlink():
        raise ValueError('Refusing to overwrite an existing diagnostic archive')
    files = []
    for file in sorted(source.rglob('*')):
        mode = file.lstat().st_mode
        if stat.S_ISLNK(mode):
            raise ValueError('Refusing a diagnostic symlink: ' + str(file))
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode):
            raise ValueError('Refusing a non-regular diagnostic file: ' + str(file))
        files.append(file)
    output.parent.mkdir(parents=True, exist_ok=True)
    entries = []
    # The trace ZIPs are already compressed. Keep their exact bytes and avoid
    # redundant compression; map the outer names so ':' never breaks upload.
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_STORED) as archive:
        for index, file in enumerate(files, 1):
            name = member_name(index, file.name)
            digest = hashlib.sha256()
            size = 0
            with file.open('rb') as incoming, archive.open(name, 'w', force_zip64=True) as outgoing:
                while data := incoming.read(1024 * 1024):
                    outgoing.write(data)
                    digest.update(data)
                    size += len(data)
            entries.append({'originalPath': file.relative_to(source).as_posix(),
                            'archivePath': name, 'bytes': size, 'sha256': digest.hexdigest()})
        manifest = {'kind': 'playwright-diagnostics', 'fileCount': len(entries), 'files': entries}
        archive.writestr('MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest = collect(args.source, args.output)
    print('Preserved diagnostic files:', manifest['fileCount'])
    print('Archive:', args.output)


if __name__ == '__main__':
    main()
