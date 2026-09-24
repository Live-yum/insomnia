#!/usr/bin/env python3
"""Maintainer-only: restore binary archives and reconcile a legacy catalog.
No pinned URL, checksum, version or lockfile is changed. Not a normal build hook.
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
        data = vendor.fetch(archive['url'])
        vendor.check_integrity(data, archive['integrity'])
        if len(data) != archive['bytes'] or hashlib.sha256(data).hexdigest() != archive['sha256']:
            raise ValueError('Registry archive differs from pinned snapshot: ' + archive['file'])
        target = vendor.VENDOR / archive['file']
        if target.parent != vendor.VENDOR / 'blobs' or target.suffix != '.tgz':
            raise ValueError('Invalid archive destination')
        target.write_bytes(data)
        vendor.read_archive(archive)
        return 1

with ThreadPoolExecutor(max_workers=12) as pool:
    repaired = sum(pool.map(repair, archives.values()))
print(f'Restored {repaired} binary archives against original checksums; inspected {len(archives)} unique archives.')

# Older snapshots collected dependencies before their JSON lockfiles were sorted.
# Re-derive the manifest from the SAME hash-verified lockfiles, including npm's
# bundled-dependency rules. Never claim an archive belongs to a different URL/SRI.
known = {(a['url'], a['integrity']): a for a in archives.values()}
for entry in manifest['entries']:
    if 'profile' not in entry:
        continue
    expected_profile = hashlib.sha256(entry['name'].encode()).hexdigest()[:20]
    if entry['profile'] != expected_profile:
        raise ValueError('Invalid profile path')
    directory = vendor.VENDOR / 'profiles' / expected_profile
    for filename, expected in entry.get('profileSha256', {}).items():
        if filename not in ('package.json', 'package-lock.json'):
            raise ValueError('Invalid profile file')
        if hashlib.sha256((directory / filename).read_bytes()).hexdigest() != expected:
            raise ValueError('Original lockfile/profile hash mismatch')
    lock = json.loads((directory / 'package-lock.json').read_text())
    dependencies = vendor.lock_packages(lock)
    for dependency in dependencies:
        archive = known.get((dependency['url'], dependency['integrity']))
        if archive:
            dependency['archive'] = archive
    entry['dependencies'] = dependencies
vendor.write_json(vendor.VENDOR / 'manifest.json', manifest)
print('Reconciled manifest ordering and bundled dependencies from unchanged, hash-verified lockfiles.')
