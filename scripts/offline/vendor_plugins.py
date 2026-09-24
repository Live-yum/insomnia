#!/usr/bin/env python3
"""Snapshot every Plugin Hub package, without executing plugin code.

Only the snapshot command uses the network. verify/materialize work from committed
archives and lockfiles; target users do not need npm or an Internet connection.
The inventory distinguishes archives, complete dependency trees, and actual tests.
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import html
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
from datetime import datetime, timezone
from urllib.parse import quote, urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

HUB = 'https://insomnia.rest/plugins'
REGISTRY = 'https://registry.npmjs.org/'
ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / 'vendor/offline-plugins'
PACKAGE = re.compile(r'(?:@[a-z0-9._-]+/)?insomnia-plugin-[a-z0-9._-]+', re.I)
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
            req = Request(url, headers={'User-Agent': 'Live-yum-insomnia-offline-vendor/1', 'Accept': 'application/json,text/html,*/*'})
            with build_opener(SafeRedirect()).open(req, timeout=40) as response:
                checked_url(response.url)
                data = response.read(limit + 1)
            if len(data) > limit:
                raise ValueError('Source exceeds archive size limit: ' + url)
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
    for item in integrity.split():
        algorithm, sep, encoded = item.partition('-')
        if sep and algorithm in ('sha512', 'sha384', 'sha256', 'sha1'):
            supported.append((algorithm, encoded.split('?')[0]))
    if not supported:
        raise ValueError('Missing supported package integrity')
    strength = {'sha1': 1, 'sha256': 2, 'sha384': 3, 'sha512': 4}
    best = max(strength[a] for a, _ in supported)
    if not any(base64.b64encode(hashlib.new(a, data).digest()).decode() == b for a, b in supported if strength[a] == best):
        raise ValueError('Package integrity mismatch')


def archive_info(data: bytes) -> dict:
    """Read data only; never extract or import a plugin while taking the snapshot."""
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        found = [m for m in archive if m.name.rstrip('/') == 'package/package.json' and m.isfile()]
        if len(found) != 1 or found[0].size > 1024 * 1024:
            raise ValueError('Missing or ambiguous package/package.json')
        stream = archive.extractfile(found[0])
        if stream is None:
            raise ValueError('Unreadable package manifest')
        return json.loads(stream.read().decode('utf-8'))


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
        temp = path.with_name(path.name + '.' + str(time.time_ns()) + '.tmp')
        temp.write_bytes(data)
        os.replace(temp, path)
    return {'file': path.relative_to(VENDOR).as_posix(), 'sha256': digest, 'bytes': len(data),
            'url': url, 'integrity': integrity, 'name': info.get('name'), 'version': info.get('version'),
            'license': license_id or 'REVIEW_REQUIRED', 'scripts': {k: v for k, v in info.get('scripts', {}).items() if k in ('preinstall', 'install', 'postinstall', 'prepare')},
            'os': info.get('os', []), 'cpu': info.get('cpu', []), 'bin': info.get('bin', {})}


def discover(raw: bytes) -> list[str]:
    text = html.unescape(raw.decode('utf-8')).replace('\\/', '/').replace('\\u002F', '/')
    # Include package names from both the rendered cards and serialized page data.
    names = {m.group(0).rstrip('.') for m in PACKAGE.finditer(text)}
    if len(names) < 50:
        raise ValueError('Plugin Hub extraction returned too few entries; refuse a misleading partial catalog')
    return sorted(names)


def snapshot_one(name: str, work: Path) -> dict:
    entry = {'name': name, 'status': 'unresolved', 'tested': False, 'defaultEnabled': False}
    try:
        if not SAFE_NAME.fullmatch(name):
            raise ValueError('Invalid package name')
        metadata = json.loads(fetch(REGISTRY + quote(name, safe='')))
        version = metadata.get('dist-tags', {}).get('latest')
        manifest = metadata.get('versions', {}).get(version)
        if not isinstance(manifest, dict):
            raise ValueError('No published latest version')
        entry.update(version=version, description=manifest.get('description', ''), license=manifest.get('license', ''),
                     repository=manifest.get('repository'), hub=HUB + '/' + name,
                     deprecated=manifest.get('deprecated'))
        dist = manifest['dist']
        integrity = dist.get('integrity') or 'sha1-' + base64.b64encode(bytes.fromhex(dist['shasum'])).decode()
        entry['rootArchive'] = store_archive(dist['tarball'], integrity)
        entry['status'] = 'archive-only'
        profile = hashlib.sha256(name.encode()).hexdigest()[:20]
        directory = work / profile
        directory.mkdir()
        package_json = {'name': 'offline-plugin-profile-' + profile, 'version': '1.0.0', 'private': True, 'dependencies': {name: version}}
        write_json(directory / 'package.json', package_json)
        # A clean temporary npm project, not the application workspaces. Never run
        # package lifecycle scripts. Do not pass any GitHub/npm publication token.
        env = {k: v for k, v in os.environ.items() if k not in ('NODE_AUTH_TOKEN', 'NPM_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN')}
        env.update(npm_config_ignore_scripts='true', npm_config_audit='false', npm_config_fund='false',
                   npm_config_registry=REGISTRY, npm_config_update_notifier='false', npm_config_fetch_retries='1')
        result = subprocess.run(['npm', 'install', '--package-lock-only', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--registry=' + REGISTRY],
                                cwd=directory, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=180)
        if result.returncode:
            raise ValueError('Dependency resolution failed: ' + result.stdout[-2500:])
        lock = json.loads((directory / 'package-lock.json').read_text())
        packages = []
        for location, pkg in lock.get('packages', {}).items():
            if not location:
                continue
            rel = PurePosixPath(location)
            if rel.is_absolute() or '..' in rel.parts or not location.startswith('node_modules/') or '\\' in location:
                raise ValueError('Unsafe lockfile package path: ' + location)
            if pkg.get('link'):
                raise ValueError('Linked dependencies need explicit review: ' + location)
            if pkg.get('inBundle') and not pkg.get('resolved'):
                continue
            url = pkg.get('resolved', '')
            if urlparse(url).hostname != 'registry.npmjs.org' or not pkg.get('integrity'):
                raise ValueError('Unpinned or non-registry dependency: ' + location)
            packages.append({'location': location, 'url': url, 'integrity': pkg['integrity']})
        dest = VENDOR / 'profiles' / profile
        write_json(dest / 'package.json', package_json)
        write_json(dest / 'package-lock.json', lock)
        entry.update(profile=profile, dependencies=packages, status='resolved',
                     installScriptsSuppressed=True, peerResolution='npm-default')
    except Exception as error:
        entry['error'] = str(error)[:4000]
    print(json.dumps({'package': name, 'status': entry['status']}, ensure_ascii=True), flush=True)
    return entry


def snapshot(workers: int) -> None:
    VENDOR.mkdir(parents=True, exist_ok=True)
    raw = fetch(HUB)
    names = discover(raw)
    (VENDOR / 'plugin-hub.snapshot.html').write_bytes(raw)
    write_json(VENDOR / 'catalog-names.json', names)
    print('Plugin Hub snapshot entries:', len(names), flush=True)
    with tempfile.TemporaryDirectory(prefix='insomnia-plugin-snapshot-') as temporary:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            entries = list(pool.map(lambda n: snapshot_one(n, Path(temporary)), names))
    requests = {(p['url'], p['integrity']) for e in entries for p in e.get('dependencies', [])}
    blobs, failures = {}, {}
    def download_one(key):
        try:
            return key, store_archive(*key), None
        except Exception as error:
            return key, None, str(error)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for key, blob, error in pool.map(download_one, sorted(requests)):
            if error:
                failures[key] = error
            else:
                blobs[key] = blob
    for entry in entries:
        if entry['status'] != 'resolved':
            continue
        missing = []
        scripts = []
        for package in entry['dependencies']:
            key = package['url'], package['integrity']
            if key in failures:
                missing.append({'location': package['location'], 'error': failures[key]})
            else:
                package['archive'] = blobs[key]
                if blobs[key]['scripts']:
                    scripts.append(package['location'])
        entry['status'] = 'dependency-complete-unreviewed' if not missing else 'dependency-incomplete'
        entry['missingDependencies'] = missing
        entry['lifecycleReview'] = scripts
    entries.sort(key=lambda e: e['name'])
    counts = {status: sum(e['status'] == status for e in entries) for status in sorted({e['status'] for e in entries})}
    manifest = {'schemaVersion': 1, 'source': HUB, 'sourceSha256': hashlib.sha256(raw).hexdigest(),
                'capturedAt': datetime.now(timezone.utc).isoformat(), 'counts': counts, 'entries': entries,
                'complete': all(e['status'] == 'dependency-complete-unreviewed' for e in entries),
                'compatibilityVerified': False, 'securityAudited': False}
    write_json(VENDOR / 'manifest.json', manifest)
    lines = ['# Plugin snapshot report', '', 'Source: ' + HUB, '', 'Downloaded does not mean tested, safe, or usable without its external service.', '',
             '| Package | Version | Disposition |', '| --- | --- | --- |']
    lines += ['| ' + e['name'] + ' | ' + str(e.get('version', 'unknown')) + ' | ' + e['status'] + ' |' for e in entries]
    (VENDOR / 'REPORT.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps(counts, indent=2), flush=True)


def verify(require_complete: bool = False) -> dict:
    manifest = json.loads((VENDOR / 'manifest.json').read_text())
    raw = (VENDOR / 'plugin-hub.snapshot.html').read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest['sourceSha256']:
        raise ValueError('Plugin Hub snapshot hash mismatch')
    if discover(raw) != [e['name'] for e in manifest['entries']]:
        raise ValueError('Catalog contains missing or extra entries')
    checked = set()
    for entry in manifest['entries']:
        archives = [entry['rootArchive']] if 'rootArchive' in entry else []
        archives += [p['archive'] for p in entry.get('dependencies', []) if 'archive' in p]
        for archive in archives:
            if not re.fullmatch(r'blobs/[0-9a-f]{64}\.tgz', archive['file']):
                raise ValueError('Invalid archive path')
            if archive['file'] not in checked:
                data = (VENDOR / archive['file']).read_bytes()
                if hashlib.sha256(data).hexdigest() != archive['sha256'] or len(data) != archive['bytes']:
                    raise ValueError('Archive hash/size mismatch: ' + archive['file'])
                check_integrity(data, archive['integrity'])
                checked.add(archive['file'])
    if require_complete and not manifest['complete']:
        raise ValueError('Snapshot has unresolved plugins; consult vendor/offline-plugins/manifest.json')
    print('Verified archive files:', len(checked), flush=True)
    return manifest


def unpack(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    expanded, count = 0, 0
    seen = set()
    with tarfile.open(archive_path, 'r:gz') as archive:
        for member in archive:
            count += 1
            p = PurePosixPath(member.name)
            if not p.parts or p.parts[0] != 'package' or p.is_absolute() or '..' in p.parts or '\\' in member.name:
                raise ValueError('Unsafe archive member')
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError('Links/devices are not permitted in an offline plugin archive')
            relative = p.parts[1:]
            if not relative or relative in seen:
                raise ValueError('Duplicate/empty archive member')
            seen.add(relative)
            expanded += member.size
            if count > 100000 or expanded > 512 * 1024 * 1024:
                raise ValueError('Expanded archive exceeds limits')
            target = destination.joinpath(*relative)
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
        record = {'name': entry['name'], 'status': entry['status'], 'defaultEnabled': False}
        if entry['status'] != 'dependency-complete-unreviewed':
            records.append(record)
            continue
        profile = entry['profile']
        dest = output / profile
        try:
            for package in sorted(entry['dependencies'], key=lambda p: (p['location'].count('/'), p['location'])):
                archive = package['archive']
                unpack(VENDOR / archive['file'], dest / package['location'])
            package_path = dest / 'node_modules' / entry['name']
            if not (package_path / 'package.json').is_file():
                raise ValueError('Plugin package missing after extraction')
            record.update(profile=profile, path=(Path(profile) / 'node_modules').as_posix(),
                          lifecycleReview=entry['lifecycleReview'], target=target,
                          status='materialized-unreviewed', tested=False)
        except Exception as error:
            shutil.rmtree(dest, ignore_errors=True)
            record.update(status='materialization-failed', error=str(error))
        records.append(record)
    write_json(output / 'catalog.json', {'target': target, 'entries': records, 'tested': False})
    print('Materialized plugin profiles:', sum(e['status'] == 'materialized-unreviewed' for e in records), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['snapshot', 'verify', 'materialize'])
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--require-complete', action='store_true')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--target', choices=['win32-x64', 'linux-arm64'])
    args = parser.parse_args()
    if args.command == 'snapshot':
        snapshot(max(1, min(args.workers, 12)))
    elif args.command == 'verify':
        verify(args.require_complete)
    else:
        if not args.output or not args.target:
            parser.error('materialize requires --output and --target')
        materialize(args.output, args.target)


if __name__ == '__main__':
    main()
