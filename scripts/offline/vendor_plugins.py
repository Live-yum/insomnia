#!/usr/bin/env python3
"""Vendor the entire public Plugin Hub snapshot without executing plugin code.

snapshot/repair require network access; verify/materialize are strictly local.
A complete dependency closure is not a compatibility or security certification.
"""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
from urllib.parse import quote, urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

HUB = 'https://insomnia.rest/plugins'
REGISTRY = 'https://registry.npmjs.org/'
ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / 'vendor/offline-plugins'
SAFE_NAME = re.compile(r'(?:@[a-z0-9._-]+/)?[a-z0-9][a-z0-9._-]*\Z', re.I)
MAX_ARCHIVE = 48 * 1024 * 1024
ALLOWED_HOSTS = {'insomnia.rest', 'www.insomnia.rest', 'registry.npmjs.org'}


def checked_url(url: str) -> str:
    p = urlparse(url)
    if p.scheme != 'https' or p.hostname not in ALLOWED_HOSTS or p.username or p.password or p.port not in (None, 443):
        raise ValueError('Unapproved package source: ' + url)
    return url


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        checked_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url: str, limit: int = MAX_ARCHIVE) -> bytes:
    checked_url(url)
    for attempt in range(3):
        try:
            req = Request(url, headers={'User-Agent': 'Live-yum-insomnia-offline-vendor/2'})
            with build_opener(SafeRedirect()).open(req, timeout=40) as response:
                checked_url(response.url)
                data = response.read(limit + 1)
            if len(data) > limit:
                raise ValueError('Source exceeds archive size limit')
            return data
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError('unreachable')


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def check_integrity(data: bytes, integrity: str) -> None:
    supported = []
    strengths = {'sha1': 1, 'sha256': 2, 'sha384': 3, 'sha512': 4}
    for item in integrity.split():
        algorithm, sep, encoded = item.partition('-')
        if sep and algorithm in strengths:
            supported.append((algorithm, encoded.split('?')[0]))
    if not supported:
        raise ValueError('Missing supported package integrity')
    best = max(strengths[a] for a, _ in supported)
    if not any(base64.b64encode(hashlib.new(a, data).digest()).decode() == b for a, b in supported if strengths[a] == best):
        raise ValueError('Package integrity mismatch')


class HubDataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.parts = []
        self.matches = 0

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('id') == '__NEXT_DATA__':
            self.matches += 1
            self.active = True

    def handle_endtag(self, tag):
        if tag == 'script':
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)


def discover(raw: bytes) -> list[str]:
    parser = HubDataParser()
    parser.feed(raw.decode('utf-8'))
    if parser.matches != 1:
        raise ValueError('Plugin Hub schema changed; expected one __NEXT_DATA__ snapshot')
    items = json.loads(''.join(parser.parts))['props']['pageProps']['plugins']
    names = []
    for item in items:
        name = item['name']
        if not isinstance(name, str) or not SAFE_NAME.fullmatch(name):
            raise ValueError('Invalid package name in Plugin Hub data')
        names.append(name)
    if len(names) < 50 or len(names) != len(set(names)):
        raise ValueError('Incomplete or duplicate Plugin Hub catalog')
    return sorted(names)


def safe_parts(name: str, windows: bool = False) -> tuple[str, ...]:
    p = PurePosixPath(name)
    if p.is_absolute() or not p.parts or '..' in p.parts or '\\' in name or ':' in name or any(ord(c) < 32 for c in name):
        raise ValueError('Unsafe package path: ' + repr(name))
    if windows:
        reserved = re.compile(r'(?i)^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)')
        if any(part.rstrip(' .') != part or reserved.match(part) or any(c in part for c in '<>"|?*') for part in p.parts):
            raise ValueError('Package path is not Windows-portable: ' + repr(name))
    return p.parts


def archive_info(data: bytes) -> dict:
    # Old npm packages, notably @types/*, use a package-name prefix rather than package/.
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        found = []
        count = 0
        for member in archive:
            count += 1
            if count > 100000:
                raise ValueError('Too many archive entries')
            parts = safe_parts(member.name)
            if len(parts) == 2 and parts[1] == 'package.json' and member.isfile():
                if member.size > 1024 * 1024:
                    raise ValueError('Oversized package.json')
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError('Unreadable package.json')
                found.append(json.loads(stream.read().decode('utf-8')))
        if len(found) != 1:
            raise ValueError('Missing or ambiguous top-level package.json')
        return found[0]


def store_archive(url: str, integrity: str) -> dict:
    if urlparse(url).hostname != 'registry.npmjs.org':
        raise ValueError('Dependency must be an npm registry archive: ' + url)
    data = fetch(url)
    check_integrity(data, integrity)
    digest = hashlib.sha256(data).hexdigest()
    info = archive_info(data)
    license_id = info.get('license', '')
    if isinstance(license_id, dict):
        license_id = license_id.get('type', '')
    if str(license_id).upper() == 'UNLICENSED' or info.get('private') is True:
        raise ValueError('Redistribution review required for explicitly private/unlicensed package')
    path = VENDOR / 'blobs' / (digest + '.tgz')
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        temporary = path.with_name(path.name + '.' + str(time.time_ns()) + '.tmp')
        temporary.write_bytes(data)
        os.replace(temporary, path)
    return {'file': path.relative_to(VENDOR).as_posix(), 'sha256': digest, 'bytes': len(data),
            'url': url, 'integrity': integrity, 'name': info.get('name'), 'version': info.get('version'),
            'license': license_id or 'REVIEW_REQUIRED',
            'scripts': {k: v for k, v in info.get('scripts', {}).items() if k in ('preinstall', 'install', 'postinstall', 'prepare')},
            'os': info.get('os', []), 'cpu': info.get('cpu', []), 'bin': info.get('bin', {})}


def lock_packages(lock: dict) -> list[dict]:
    packages = []
    for location, pkg in lock.get('packages', {}).items():
        if not location:
            continue
        parts = safe_parts(location)
        if parts[0] != 'node_modules' or pkg.get('link'):
            raise ValueError('Invalid or linked lockfile package path: ' + location)
        if pkg.get('inBundle') and not pkg.get('resolved'):
            continue
        url = pkg.get('resolved', '')
        if urlparse(url).hostname != 'registry.npmjs.org' or not pkg.get('integrity'):
            raise ValueError('Unpinned or non-registry dependency: ' + location)
        checked_url(url)
        packages.append({'location': location, 'url': url, 'integrity': pkg['integrity']})
    return packages


def snapshot_one(name: str, work: Path) -> dict:
    entry = {'name': name, 'status': 'unresolved', 'tested': False, 'defaultEnabled': False}
    try:
        metadata = json.loads(fetch(REGISTRY + quote(name, safe='')))
        version = metadata.get('dist-tags', {}).get('latest')
        manifest = metadata.get('versions', {}).get(version)
        if not isinstance(manifest, dict):
            raise ValueError('No published latest version')
        entry.update(version=version, description=manifest.get('description', ''), license=manifest.get('license', ''),
                     repository=manifest.get('repository'), hub=HUB + '/' + name, deprecated=manifest.get('deprecated'))
        dist = manifest['dist']
        integrity = dist.get('integrity') or 'sha1-' + base64.b64encode(bytes.fromhex(dist['shasum'])).decode()
        entry['rootArchive'] = store_archive(dist['tarball'], integrity)
        entry['status'] = 'archive-only'
        profile = hashlib.sha256(name.encode()).hexdigest()[:20]
        directory = work / profile
        directory.mkdir()
        package_json = {'name': 'offline-plugin-profile-' + profile, 'version': '1.0.0', 'private': True, 'dependencies': {name: version}}
        write_json(directory / 'package.json', package_json)
        env = {k: v for k, v in os.environ.items() if k not in ('NODE_AUTH_TOKEN', 'NPM_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN')}
        env.update(npm_config_ignore_scripts='true', npm_config_audit='false', npm_config_fund='false',
                   npm_config_registry=REGISTRY, npm_config_update_notifier='false', npm_config_fetch_retries='1')
        result = subprocess.run(['npm', 'install', '--package-lock-only', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--registry=' + REGISTRY],
                                cwd=directory, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=180)
        if result.returncode:
            raise ValueError('Dependency resolution failed: ' + result.stdout[-2500:])
        lock = json.loads((directory / 'package-lock.json').read_text())
        packages = lock_packages(lock)
        dest = VENDOR / 'profiles' / profile
        write_json(dest / 'package.json', package_json)
        write_json(dest / 'package-lock.json', lock)
        entry.update(profile=profile, dependencies=packages, status='resolved', installScriptsSuppressed=True)
    except Exception as error:
        entry['error'] = str(error)[:4000]
    print(json.dumps({'package': name, 'status': entry['status']}), flush=True)
    return entry


def finish_snapshot(raw: bytes, entries: list[dict], workers: int) -> None:
    requests = {(p['url'], p['integrity']) for e in entries for p in e.get('dependencies', []) if 'archive' not in p}
    known = {(p['url'], p['integrity']): p['archive'] for e in entries for p in e.get('dependencies', []) if 'archive' in p}
    failures = {}
    def download_one(key):
        try:
            return key, store_archive(*key), None
        except Exception as error:
            return key, None, str(error)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for key, blob, error in pool.map(download_one, sorted(requests - known.keys())):
            if error:
                failures[key] = error
            else:
                known[key] = blob
    used_files, used_profiles = set(), set()
    for entry in entries:
        if 'rootArchive' in entry:
            used_files.add(entry['rootArchive']['file'])
        if 'profile' not in entry:
            continue
        used_profiles.add(entry['profile'])
        profile = VENDOR / 'profiles' / entry['profile']
        entry['profileSha256'] = {f: hashlib.sha256((profile / f).read_bytes()).hexdigest() for f in ('package.json', 'package-lock.json')}
        missing, scripts = [], []
        for package in entry.get('dependencies', []):
            key = package['url'], package['integrity']
            if key not in known:
                missing.append({'location': package['location'], 'error': failures.get(key, 'Archive missing')})
            else:
                package['archive'] = known[key]
                used_files.add(known[key]['file'])
                if known[key]['scripts']:
                    scripts.append(package['location'])
        entry.update(status='dependency-complete-unreviewed' if not missing else 'dependency-incomplete',
                     missingDependencies=missing, lifecycleReview=scripts, tested=False, defaultEnabled=False)
        entry.pop('error', None)
    entries.sort(key=lambda e: e['name'])
    counts = {status: sum(e['status'] == status for e in entries) for status in sorted({e['status'] for e in entries})}
    manifest = {'schemaVersion': 2, 'source': HUB, 'sourceSha256': hashlib.sha256(raw).hexdigest(),
                'capturedAt': datetime.now(timezone.utc).isoformat(), 'counts': counts, 'entries': entries,
                'complete': all(e['status'] == 'dependency-complete-unreviewed' for e in entries),
                'compatibilityVerified': False, 'securityAudited': False}
    write_json(VENDOR / 'manifest.json', manifest)
    write_json(VENDOR / 'catalog-names.json', discover(raw))
    # Remove false-positive URL fragments and their now-unreferenced blobs from the working tree.
    for file in (VENDOR / 'blobs').glob('*.tgz'):
        if file.relative_to(VENDOR).as_posix() not in used_files:
            file.unlink()
    for directory in (VENDOR / 'profiles').iterdir():
        if directory.is_dir() and directory.name not in used_profiles:
            shutil.rmtree(directory)
    lines = ['# Plugin snapshot report', '', 'Source: ' + HUB, '', 'Catalog entries: ' + str(len(entries)), '',
             'Downloaded does not mean tested, safe, or usable without external services. All plugins start disabled.', '',
             '| Package | Version | Disposition |', '| --- | --- | --- |']
    lines += ['| ' + e['name'] + ' | ' + str(e.get('version', 'unknown')) + ' | ' + e['status'] + ' |' for e in entries]
    (VENDOR / 'REPORT.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    write_json(VENDOR / 'EXCEPTIONS.json', [e for e in entries if e['status'] != 'dependency-complete-unreviewed'])
    print(json.dumps(counts, indent=2), flush=True)


def snapshot(workers: int, repair: bool = False) -> None:
    VENDOR.mkdir(parents=True, exist_ok=True)
    raw = (VENDOR / 'plugin-hub.snapshot.html').read_bytes() if repair else fetch(HUB)
    names = discover(raw)
    (VENDOR / 'plugin-hub.snapshot.html').write_bytes(raw)
    if repair:
        prior = json.loads((VENDOR / 'manifest.json').read_text())
        by_name = {e['name']: e for e in prior['entries']}
        if any(name not in by_name for name in names):
            raise ValueError('Repair requires all catalog entries in the existing snapshot')
        entries = [by_name[name] for name in names]
    else:
        with tempfile.TemporaryDirectory(prefix='insomnia-plugin-snapshot-') as temporary:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                entries = list(pool.map(lambda name: snapshot_one(name, Path(temporary)), names))
    finish_snapshot(raw, entries, workers)
    verify()


def read_archive(info: dict) -> bytes:
    if not re.fullmatch(r'blobs/[0-9a-f]{64}\.tgz', info['file']):
        raise ValueError('Invalid archive path')
    data = (VENDOR / info['file']).read_bytes()
    if hashlib.sha256(data).hexdigest() != info['sha256'] or len(data) != info['bytes']:
        raise ValueError('Archive hash/size mismatch: ' + info['file'])
    check_integrity(data, info['integrity'])
    return data


def verify(require_complete: bool = False) -> dict:
    manifest = json.loads((VENDOR / 'manifest.json').read_text())
    raw = (VENDOR / 'plugin-hub.snapshot.html').read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest['sourceSha256'] or discover(raw) != [e['name'] for e in manifest['entries']]:
        raise ValueError('Catalog contents or source hash mismatch')
    checked = set()
    for entry in manifest['entries']:
        archives = [entry['rootArchive']] if 'rootArchive' in entry else []
        archives += [p['archive'] for p in entry.get('dependencies', []) if 'archive' in p]
        for archive in archives:
            if archive['file'] not in checked:
                read_archive(archive)
                checked.add(archive['file'])
        if 'profile' in entry:
            if entry['profile'] != hashlib.sha256(entry['name'].encode()).hexdigest()[:20]:
                raise ValueError('Invalid plugin profile path')
            directory = VENDOR / 'profiles' / entry['profile']
            for filename, expected in entry.get('profileSha256', {}).items():
                if filename not in ('package.json', 'package-lock.json') or hashlib.sha256((directory / filename).read_bytes()).hexdigest() != expected:
                    raise ValueError('Profile hash mismatch')
            lock = json.loads((directory / 'package-lock.json').read_text())
            expected = lock_packages(lock)
            actual = [{k: p[k] for k in ('location', 'url', 'integrity')} for p in entry['dependencies']]
            if expected != actual:
                raise ValueError('Dependency manifest differs from lockfile: ' + entry['name'])
            if entry['status'] == 'dependency-complete-unreviewed' and any('archive' not in p for p in entry['dependencies']):
                raise ValueError('A complete profile has missing archives')
    if require_complete and any(e['status'] != 'dependency-complete-unreviewed' for e in manifest['entries']):
        raise ValueError('Unresolved plugins remain; consult EXCEPTIONS.json')
    print('Verified archive files:', len(checked), flush=True)
    return manifest


def unpack(archive_path: Path, destination: Path, windows: bool = False) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    expanded, count, prefix = 0, 0, None
    seen = set()
    with tarfile.open(archive_path, 'r:gz') as archive:
        for member in archive:
            count += 1
            parts = safe_parts(member.name, windows)
            if prefix is None:
                prefix = parts[0]
            if parts[0] != prefix:
                raise ValueError('Multiple archive root directories')
            if member.isdir():
                continue
            if not member.isfile() or len(parts) < 2:
                raise ValueError('Links, devices and root-level files are not permitted')
            relative = parts[1:]
            key = '/'.join(relative).casefold() if windows else '/'.join(relative)
            if key in seen:
                raise ValueError('Duplicate or case-colliding archive path')
            seen.add(key)
            expanded += member.size
            if count > 100000 or expanded > 512 * 1024 * 1024:
                raise ValueError('Expanded archive exceeds limits')
            target = destination.joinpath(*relative)
            if target.is_symlink() or any(p.is_symlink() for p in target.parents):
                raise ValueError('Symlink extraction destination')
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise ValueError('Unreadable archive member')
            with target.open('wb') as out:
                shutil.copyfileobj(source, out)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)


def materialize(output: Path, target: str) -> None:
    manifest = verify()
    if output.exists():
        raise ValueError('Output already exists; use a new directory')
    output.mkdir(parents=True)
    records = []
    for entry in manifest['entries']:
        record = {'name': entry['name'], 'version': entry.get('version'), 'status': entry['status'], 'defaultEnabled': False}
        if entry['status'] != 'dependency-complete-unreviewed':
            record['error'] = entry.get('error', 'Dependency archives incomplete')
            records.append(record)
            continue
        profile = entry['profile']
        dest = output / profile
        try:
            for package in sorted(entry['dependencies'], key=lambda p: (p['location'].count('/'), p['location'])):
                safe_parts(package['location'], target == 'win32-x64')
                archive = package['archive']
                unpack(VENDOR / archive['file'], dest / package['location'], target == 'win32-x64')
            package_path = dest / 'node_modules' / entry['name']
            package_json = json.loads((package_path / 'package.json').read_text())
            if package_json.get('name') != entry['name'] or package_json.get('version') != entry['version']:
                raise ValueError('Root package identity mismatch')
            record.update(profile=profile, path=(Path(profile) / 'node_modules' / entry['name']).as_posix(),
                          lifecycleReview=entry['lifecycleReview'], target=target,
                          status='materialized-unreviewed', tested=False)
        except Exception as error:
            shutil.rmtree(dest, ignore_errors=True)
            record.update(status='materialization-failed', error=str(error))
        records.append(record)
    write_json(output / 'catalog.json', {'target': target, 'entries': records, 'tested': False, 'sourceSha256': manifest['sourceSha256']})
    print('Materialized plugin profiles:', sum(e['status'] == 'materialized-unreviewed' for e in records), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['snapshot', 'repair', 'verify', 'materialize'])
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--require-complete', action='store_true')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--target', choices=['win32-x64', 'linux-arm64'])
    args = parser.parse_args()
    if args.command in ('snapshot', 'repair'):
        snapshot(max(1, min(args.workers, 12)), args.command == 'repair')
    elif args.command == 'verify':
        verify(args.require_complete)
    else:
        if not args.output or not args.target:
            parser.error('materialize requires --output and --target')
        materialize(args.output, args.target)


if __name__ == '__main__':
    main()
