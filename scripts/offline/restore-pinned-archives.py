#!/usr/bin/env python3
"""Maintainer-only: repair binary archives affected by historical Git text normalization.

Never changes the pinned URL, expected SHA256, registry integrity or version.
Do not run this during normal application builds or startup.
"""
import hashlib
import importlib.util
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SCRIPT = Path(__file__).with_name('vendor_plugins.py')
spec = importlib.util.spec_from_file_location('vendor_plugins', SCRIPT)
vendor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vendor)
manifest = json.loads((vendor.VENDOR / 'manifest.json').read_text())
archives = {}
for entry in manifest['entries']:
    if 'rootArchive' in entry:
        archive = entry['rootArchive']
        archives[archive['file']] = archive
    for dependency in entry.get('dependencies', []):
        if 'archive' in dependency:
            archive = dependency['archive']
            archives[archive['file']] = archive

def repair(archive):
    try:
        vendor.read_archive(archive)
        return 0
    except (ValueError, FileNotFoundError):
        # Only an archive with exactly the ORIGINAL checksums can replace the file.
        data = vendor.fetch(archive['url'])
        vendor.check_integrity(data, archive['integrity'])
        if len(data) != archive['bytes'] or hashlib.sha256(data).hexdigest() != archive['sha256']:
            raise ValueError('Registry archive differs from the pinned snapshot: ' + archive['file'])
        target = vendor.VENDOR / archive['file']
        if target.parent != vendor.VENDOR / 'blobs' or target.suffix != '.tgz':
            raise ValueError('Invalid archive destination')
        target.write_bytes(data)
        vendor.read_archive(archive)
        return 1

with ThreadPoolExecutor(max_workers=12) as pool:
    repaired = sum(pool.map(repair, archives.values()))
print(f'Restored {repaired} binary archives against original checksums; inspected {len(archives)} unique archives.')
