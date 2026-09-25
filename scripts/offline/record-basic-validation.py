"""Bind actual packaged Chinese/crypto evidence to the exact basic release revision."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def load(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('Missing or invalid acceptance evidence: ' + str(path))
    return json.loads(path.read_text(encoding='utf-8-sig'))


def bind(smoke, chinese, crypto, commit, target):
    for report in (smoke, chinese, crypto):
        if report.get('status') != 'passed' or report.get('sourceCommit') != commit or report.get('target') != target:
            raise ValueError('Acceptance evidence does not match the exact successful source and platform')
    if smoke.get('edition') != 'basic' or smoke.get('noCommunityPluginPayload') is not True:
        raise ValueError('Expected a real compact basic distribution')
    for key in ['chineseDefaultOnEnglishSystem', 'chineseProjectCreation', 'chineseApplicationSettings',
                'nativeEngineLocale', 'englishPreferencePersistedAcrossRestart',
                'chinesePreferencePersistedAcrossRestart', 'authoredUserDataPreserved', 'packaged']:
        if chinese.get(key) is not True:
            raise ValueError('Missing real Chinese interface check: ' + key)
    for key in ['authenticatedPackagedCryptoBridge', 'packagedSm2Sm3Sm4Verified',
                'packagedAuthenticatedDecryptionRejectsTampering', 'aesGcmUiRoundtrip',
                'tamperedTagRejectedWithoutPlaintext', 'languagePersistedAcrossProcessRestart',
                'sensitiveFieldsClearedOnClose', 'packaged']:
        if crypto.get(key) is not True:
            raise ValueError('Missing real packaged cryptography check: ' + key)
    required = {'sm2-c1c3c2', 'sm2-c1c2c3', 'sm2-sign-raw', 'sm2-sign-der', 'sm3-known-answer',
                'sm4-known-answer', 'sm4-cbc', 'sm4-ctr', 'sha3-known-answer', 'rsa-oaep'}
    required.update(f'aes-{bits}-{mode}' for bits in (128, 192, 256) for mode in ('gcm', 'cbc', 'ctr'))
    required.update('signature-and-jws-' + alg for alg in ('RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'))
    required.update('jws-' + alg for alg in ('HS256', 'HS384', 'HS512'))
    required.update('encoding-' + encoding for encoding in ('hex', 'base64', 'base64url'))
    coverage = crypto.get('cryptoBridgeCoverage', [])
    if not isinstance(coverage, list) or set(coverage) != required or crypto.get('cryptoBridgeChecks') != len(required):
        raise ValueError('Incomplete or unexpected packaged cryptographic coverage')
    return {**smoke, 'defaultUiLocale': 'zh-CN', 'chineseDesktopAcceptance': chinese,
            'packagedCryptoAcceptance': crypto, 'allCommunityPluginsBundled': False,
            'industrialProtocols': {'mqtt': False, 'opcUa': False, 'status': 'optional-not-in-this-basic-release'},
            'siteSpecificEgressCertified': False, 'codeSigned': False,
            'translationScope': 'Authored desktop strings, native menus and verified core flows; technical identifiers and user data are not translated'}


def main():
    results = ROOT / 'offline-test-results'
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    target = os.environ['RESOURCE_TARGET']
    if target not in ('win32-x64', 'linux-arm64'):
        raise ValueError('Unsupported native target')
    report = bind(load(results / 'basic-smoke.json'), load(results / 'chinese-interface.json'),
                  load(results / 'crypto-workbench.json'), commit, target)
    (results / 'basic-smoke.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'sourceCommit': commit, 'target': target, 'status': report['status'],
                      'cryptoBridgeChecks': report['packagedCryptoAcceptance']['cryptoBridgeChecks'],
                      'defaultUiLocale': report['defaultUiLocale']}))


if __name__ == '__main__':
    main()
