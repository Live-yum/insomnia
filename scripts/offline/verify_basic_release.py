#!/usr/bin/env python3
"""Promote immutable, fully checked basic artifacts; never execute their contents."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import zipfile

REPOSITORY = 'Live-yum/insomnia'
MIB = 1024 * 1024
WORKFLOWS = {
    '.github/workflows/test.yml', '.github/workflows/test-cli.yml',
    '.github/workflows/test-e2e.yml', '.github/workflows/sast.yml',
    '.github/workflows/offline-crypto-core.yml', '.github/workflows/offline-portable-crypto.yml',
    '.github/workflows/offline-basic-contract.yml', '.github/workflows/offline-catalog-check.yml',
    '.github/workflows/offline-build.yml', '.github/workflows/release-recurring.yml',
}
CRYPTO_COVERAGE = {
    *(f'aes-{bits}-{mode}' for bits in (128, 192, 256) for mode in ('gcm', 'cbc', 'ctr')),
    'sm3-known-answer', 'sha3-known-answer', 'sm4-known-answer', 'sm4-cbc', 'sm4-ctr',
    'sm2-c1c3c2', 'sm2-c1c2c3', 'sm2-sign-raw', 'sm2-sign-der', 'rsa-oaep',
    *(f'signature-and-jws-{alg}' for alg in ('RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA')),
    'jws-HS256', 'jws-HS384', 'jws-HS512', 'encoding-hex', 'encoding-base64', 'encoding-base64url',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size < 2 * MIB, 'Missing or oversized JSON evidence')
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def api(suffix):
    return json.loads(subprocess.check_output(['gh', 'api', '--method', 'GET', f'repos/{REPOSITORY}/{suffix}'], text=True, encoding='utf-8'))


def pages(suffix, key):
    values = []
    separator = '&' if '?' in suffix else '?'
    for page in range(1, 11):
        rows = api(f'{suffix}{separator}per_page=100&page={page}')[key]
        values.extend(rows)
        if len(rows) < 100:
            return values
    raise ValueError('Evidence pagination exceeded its bounded limit')


def validate_run(run, source, path, event):
    require(run.get('head_sha') == source and run.get('path') == path and run.get('event') == event, 'Run source, path or event mismatch')
    require(run.get('head_repository', {}).get('full_name') == REPOSITORY, 'Foreign workflow source')
    require(run.get('status') == 'completed' and run.get('conclusion') == 'success', 'Workflow did not actually pass')


def validate_report(report, source, target, version):
    resource = 'win32-x64' if target == 'windows-x64' else target
    for key, expected in {'edition': 'basic', 'status': 'passed', 'sourceCommit': source, 'target': resource, 'defaultUiLocale': 'zh-CN', 'communityPlugins': 0}.items():
        require(report.get(key) == expected, f'{target}: invalid {key}')
    for key in ('cleanProfileNoLogin', 'localProjectPersistence', 'authenticatedHmacBridge', 'browserReachableControlBlocked', 'realNativeLoopbackApiPassed', 'noCommunityPluginPayload', 'extractionHashVerified'):
        require(report.get(key) is True, f'{target}: missing {key}')
    require(set(report.get('reviewedBundledPlugins', [])) == {'insomnia-plugin-crypto', 'insomnia-plugin-offline-crypto-tools'}, 'Unexpected bundled plugins')
    require(report.get('violations') == [] and report.get('forbiddenPaths') == [], 'Package budget or forbidden content failure')
    for key, maximum in {'archiveBytes': 350 * MIB, 'unpackedBytes': 900 * MIB, 'fileCount': 1500, 'directoryCount': 300}.items():
        require(type(report.get(key)) is int and 0 < report[key] <= maximum, f'{target}: budget exceeded: {key}')
    require(isinstance(report.get('freshExtractionSeconds'), (int, float)) and report['freshExtractionSeconds'] > 0, 'Fresh extraction was not measured')
    chinese = report.get('chineseDesktopAcceptance', {})
    crypto = report.get('packagedCryptoAcceptance', {})
    for evidence in (chinese, crypto):
        require(evidence.get('status') == 'passed' and evidence.get('packaged') is True and evidence.get('sourceCommit') == source and evidence.get('target') == resource, 'Wrong source or unpackaged acceptance evidence')
    for key in ('chineseDefaultOnEnglishSystem', 'chineseProjectCreation', 'chineseApplicationSettings', 'nativeEngineLocale', 'englishPreferencePersistedAcrossRestart', 'chinesePreferencePersistedAcrossRestart', 'authoredUserDataPreserved'):
        require(chinese.get(key) is True, 'Missing Chinese acceptance: ' + key)
    for key in ('chineseDefaultWorkbench', 'authenticatedDigestBridge', 'aesGcmUiRoundtrip', 'tamperedTagRejectedWithoutPlaintext', 'languagePersistedAcrossProcessRestart', 'sensitiveFieldsClearedOnClose', 'authenticatedPackagedCryptoBridge', 'packagedSm2Sm3Sm4Verified', 'packagedAuthenticatedDecryptionRejectsTampering'):
        require(crypto.get(key) is True, 'Missing cryptography acceptance: ' + key)
    coverage = crypto.get('cryptoBridgeCoverage', [])
    require(type(coverage) is list and len(set(coverage)) == len(coverage) and CRYPTO_COVERAGE <= set(coverage), 'Missing or duplicate cryptography coverage')
    require(type(crypto.get('cryptoBridgeChecks')) is int and crypto['cryptoBridgeChecks'] >= len(CRYPTO_COVERAGE), 'Missing executed cryptography checks')
    if target == 'windows-x64':
        proof = report.get('freshExtractedWindowsWrapper', {})
        require(proof.get('status') == 'passed' and proof.get('freshPayloadRequired') is True and proof.get('runtimePayloadHashVerified') is True and proof.get('debuggerArguments') is False and proof.get('sandboxDisabled') is False, 'Unverified fresh Windows wrapper')
    extension = '.zip' if target == 'windows-x64' else '.tar.gz'
    name = f'Insomnia-Offline-{version}-basic-{target}-portable{extension}'
    require(report.get('archive') == name and re.fullmatch(r'[0-9a-f]{64}', report.get('archiveSha256', '')), 'Unexpected archive name or digest')
    return name


def extract_artifact(archive, destination, allowed):
    """Extract bounded flat evidence files only; native archives stay opaque."""
    with zipfile.ZipFile(archive) as bundle:
        files = bundle.infolist()
        require(len(files) == len(allowed) and {entry.filename for entry in files} == set(allowed), 'Unexpected artifact members')
        require(len({entry.filename for entry in files}) == len(files), 'Duplicate artifact member')
        for entry in files:
            require(entry.filename == Path(entry.filename).name and '/' not in entry.filename and '\\' not in entry.filename, 'Unsafe artifact path')
            kind = stat.S_IFMT(entry.external_attr >> 16)
            require(not entry.is_dir() and kind in (0, stat.S_IFREG) and not (entry.flag_bits & 1), 'Non-regular or encrypted artifact entry')
            require(0 < entry.file_size <= allowed[entry.filename], 'Oversized artifact entry')
            target = destination / entry.filename
            with bundle.open(entry) as src, target.open('xb') as dst:
                shutil.copyfileobj(src, dst, length=MIB)


def prepare(request_path, output):
    request = read_json(request_path)
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY, 'Unexpected repository')
    source, tag = request['sourceCommit'], request['tag']
    require(re.fullmatch(r'[0-9a-f]{40}', source), 'Exact source commit required')
    require(re.fullmatch(r'offline-basic-v13\.3\.0-rc\.[1-9][0-9]*', tag), 'Use a new compact candidate tag')
    number, portable_id = request['pullRequest'], request['portableRun']
    require(type(number) is int and number > 0 and type(portable_id) is int and portable_id > 0, 'Invalid request identifiers')
    pr = api(f'pulls/{number}')
    require(pr['base']['ref'] == 'develop' and pr['head']['ref'] == 'offline/complete-portable', 'Unexpected PR branches')
    require(pr['base']['repo']['full_name'] == pr['head']['repo']['full_name'] == REPOSITORY, 'Foreign PR')
    require(pr['head']['sha'] == source and not pr['draft'], 'Source is stale or PR is still a draft')
    require(pr['state'] == 'open' or pr['merged'], 'Closed unmerged PR is not a release source')
    runs = pages(f'actions/runs?head_sha={source}&event=pull_request', 'workflow_runs')
    latest = {}
    for run in sorted(runs, key=lambda row: (row['created_at'], row['id']), reverse=True):
        latest.setdefault(run['path'], run)
    require(WORKFLOWS <= latest.keys(), 'Missing required workflow runs on this PR head')
    checks = []
    for path in sorted(WORKFLOWS):
        run = latest[path]
        validate_run(run, source, path, 'pull_request')
        require(any(p['number'] == number and p['base']['sha'] == pr['base']['sha'] for p in run['pull_requests']), 'Workflow checked a different PR base')
        checks.append({'path': path, 'run': run['id'], 'attempt': run['run_attempt'], 'conclusion': run['conclusion']})
    ui = latest['.github/workflows/test-e2e.yml']
    jobs = pages(f"actions/runs/{ui['id']}/jobs", 'jobs')
    require(all(job['conclusion'] == 'success' for job in jobs), 'Skipped or unsuccessful UI job')
    require({f'test ({i}, 6)' for i in range(1, 7)} <= {job['name'] for job in jobs}, 'Missing UI shard')
    portable = api(f'actions/runs/{portable_id}')
    validate_run(portable, source, '.github/workflows/offline-build.yml', 'push')
    require(portable['head_branch'] == 'offline/complete-portable', 'Wrong portable branch')
    native_jobs = pages(f'actions/runs/{portable_id}/jobs', 'jobs')
    require(all(job['conclusion'] == 'success' for job in native_jobs), 'Native validation did not fully execute')
    require(sum('build (' in job['name'] for job in native_jobs) == 2 and any('windows-x64' in job['name'] for job in native_jobs) and any('linux-arm64' in job['name'] for job in native_jobs), 'Both native targets are required')
    output.mkdir(parents=True, exist_ok=False)
    temporary = output.parent / 'basic-artifact-input'
    temporary.mkdir(exist_ok=False)
    artifacts = pages(f'actions/runs/{portable_id}/artifacts', 'artifacts')
    names = {'insomnia-basic-windows-x64', 'insomnia-basic-linux-arm64', 'offline-complete-quality'}
    selected = [entry for entry in artifacts if entry['name'] in names]
    require(len(selected) == 3 and {entry['name'] for entry in selected} == names, 'Missing or duplicate release artifacts')
    version = '13.3.0'
    for artifact in selected:
        require(not artifact['expired'] and re.fullmatch(r'sha256:[0-9a-f]{64}', artifact.get('digest', '')), 'Expired or unhashed artifact')
        if artifact['name'] == 'offline-complete-quality':
            allowed = {'offline-quality.json': 2 * MIB}
        else:
            target = artifact['name'].removeprefix('insomnia-basic-')
            extension = '.zip' if target == 'windows-x64' else '.tar.gz'
            name = f'Insomnia-Offline-{version}-basic-{target}-portable{extension}'
            allowed = {name: 350 * MIB, name + '.sha256': 4096, target + '-basic-validation.json': 2 * MIB}
        archive = temporary / (str(artifact['id']) + '.zip')
        with archive.open('xb') as stream:
            subprocess.run(['gh', 'api', f"repos/{REPOSITORY}/actions/artifacts/{artifact['id']}/zip"], stdout=stream, check=True)
        require(archive.stat().st_size == artifact['size_in_bytes'] and 'sha256:' + digest(archive) == artifact['digest'], 'Downloaded artifact digest mismatch')
        extract_artifact(archive, output, allowed)
    quality = read_json(output / 'offline-quality.json')
    require(quality.get('status') == 'passed' and quality.get('sourceCommit') == source, 'Wrong quality evidence')
    for target in ('windows-x64', 'linux-arm64'):
        report = read_json(output / (target + '-basic-validation.json'))
        name = validate_report(report, source, target, version)
        archive = output / name
        require(archive.stat().st_size == report['archiveBytes'] and digest(archive) == report['archiveSha256'], 'Native archive size or hash mismatch')
        require((output / (name + '.sha256')).read_text(encoding='utf-8').strip() == report['archiveSha256'] + '  ' + name, 'Checksum file mismatch')
    proof = {**request, 'repository': REPOSITORY, 'sourceTree': api('git/commits/' + source)['tree']['sha'],
             'pullRequestBase': pr['base']['sha'], 'pullRequestMerged': pr['merged'],
             'requiredChecks': checks, 'portableAttempt': portable['run_attempt'],
             'artifacts': [{k: a[k] for k in ('id', 'name', 'size_in_bytes', 'digest')} for a in selected]}
    (output / 'release-provenance.json').write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
    expected = [{'name': file.name, 'bytes': file.stat().st_size, 'sha256': digest(file)} for file in sorted(output.iterdir())]
    (output / 'expected-assets.json').write_text(json.dumps(expected, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(proof, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('request', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    prepare(args.request, args.output)
