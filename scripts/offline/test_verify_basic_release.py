"""Release evidence is data, never executable code; missing checks fail closed."""
import copy
import json
from pathlib import Path
import stat
import tempfile
import unittest
import warnings
import zipfile

from verify_basic_release import CRYPTO_COVERAGE, REPOSITORY, extract_artifact, validate_report, validate_run

SOURCE = 'a' * 40


def complete_report(target='windows-x64'):
    resource = 'win32-x64' if target == 'windows-x64' else target
    report = {
        'edition': 'basic', 'status': 'passed', 'sourceCommit': SOURCE, 'target': resource,
        'defaultUiLocale': 'zh-CN', 'communityPlugins': 0,
        'reviewedBundledPlugins': ['insomnia-plugin-crypto', 'insomnia-plugin-offline-crypto-tools'],
        'violations': [], 'forbiddenPaths': [], 'archiveBytes': 100, 'unpackedBytes': 1000,
        'fileCount': 200, 'directoryCount': 32, 'freshExtractionSeconds': 1.25,
        'archiveSha256': 'b' * 64,
        'archive': f'Insomnia-Offline-13.3.0-basic-{target}-portable' + ('.zip' if target == 'windows-x64' else '.tar.gz'),
    }
    for key in ('cleanProfileNoLogin', 'localProjectPersistence', 'authenticatedHmacBridge', 'browserReachableControlBlocked', 'realNativeLoopbackApiPassed', 'noCommunityPluginPayload', 'extractionHashVerified'):
        report[key] = True
    chinese = {'status': 'passed', 'packaged': True, 'sourceCommit': SOURCE, 'target': resource}
    for key in ('chineseDefaultOnEnglishSystem', 'chineseProjectCreation', 'chineseApplicationSettings', 'nativeEngineLocale', 'englishPreferencePersistedAcrossRestart', 'chinesePreferencePersistedAcrossRestart', 'authoredUserDataPreserved'):
        chinese[key] = True
    crypto = {'status': 'passed', 'packaged': True, 'sourceCommit': SOURCE, 'target': resource,
              'cryptoBridgeChecks': 35, 'cryptoBridgeCoverage': sorted(CRYPTO_COVERAGE)}
    for key in ('chineseDefaultWorkbench', 'authenticatedDigestBridge', 'aesGcmUiRoundtrip', 'tamperedTagRejectedWithoutPlaintext', 'languagePersistedAcrossProcessRestart', 'sensitiveFieldsClearedOnClose', 'authenticatedPackagedCryptoBridge', 'packagedSm2Sm3Sm4Verified', 'packagedAuthenticatedDecryptionRejectsTampering'):
        crypto[key] = True
    report.update(chineseDesktopAcceptance=chinese, packagedCryptoAcceptance=crypto,
                  freshExtractedWindowsWrapper={'status': 'passed', 'freshPayloadRequired': True,
                                               'runtimePayloadHashVerified': True, 'debuggerArguments': False,
                                               'sandboxDisabled': False})
    return report


class ReleaseEvidenceTests(unittest.TestCase):
    def test_accepts_each_native_target_with_all_35_crypto_cases(self):
        self.assertEqual(len(CRYPTO_COVERAGE), 35)
        for target in ('windows-x64', 'linux-arm64'):
            report = complete_report(target)
            self.assertEqual(validate_report(report, SOURCE, target, '13.3.0'), report['archive'])

    def test_missing_or_forged_acceptance_is_rejected(self):
        valid = complete_report()
        replacements = [('sourceCommit', 'c' * 40), ('edition', 'full'), ('communityPlugins', 545),
                        ('noCommunityPluginPayload', False), ('extractionHashVerified', False),
                        ('archiveBytes', 351 * 1024 * 1024), ('fileCount', 1501),
                        ('unpackedBytes', 901 * 1024 * 1024), ('directoryCount', 301),
                        ('archiveSha256', '../bad'), ('archive', '../archive.zip'),
                        ('violations', ['budget exceeded']), ('forbiddenPaths', ['offline-plugins']),
                        ('defaultUiLocale', 'en-US'), ('freshExtractionSeconds', 0)]
        for field, value in replacements:
            with self.subTest(field=field):
                report = copy.deepcopy(valid)
                report[field] = value
                with self.assertRaises(ValueError):
                    validate_report(report, SOURCE, 'windows-x64', '13.3.0')

    def test_every_chinese_and_crypto_proof_is_required(self):
        for group in ('chineseDesktopAcceptance', 'packagedCryptoAcceptance'):
            for field in complete_report()[group]:
                with self.subTest(group=group, field=field):
                    report = complete_report()
                    del report[group][field]
                    with self.assertRaises(ValueError):
                        validate_report(report, SOURCE, 'windows-x64', '13.3.0')

    def test_missing_sm2_or_duplicate_algorithm_is_rejected(self):
        for coverage in ([x for x in CRYPTO_COVERAGE if x != 'sm2-sign-der'], [*CRYPTO_COVERAGE, 'sm2-sign-der']):
            report = complete_report()
            report['packagedCryptoAcceptance']['cryptoBridgeCoverage'] = coverage
            with self.assertRaises(ValueError):
                validate_report(report, SOURCE, 'windows-x64', '13.3.0')

    def test_fresh_wrapper_must_preserve_security(self):
        for field, value in [('status', 'skipped'), ('runtimePayloadHashVerified', False), ('freshPayloadRequired', False), ('sandboxDisabled', True), ('debuggerArguments', True)]:
            report = complete_report()
            report['freshExtractedWindowsWrapper'][field] = value
            with self.assertRaises(ValueError):
                validate_report(report, SOURCE, 'windows-x64', '13.3.0')

    def test_only_successful_exact_source_event_and_repository_are_accepted(self):
        run = {'head_sha': SOURCE, 'path': '.github/workflows/offline-build.yml', 'event': 'push',
               'head_repository': {'full_name': REPOSITORY}, 'status': 'completed', 'conclusion': 'success'}
        validate_run(run, SOURCE, run['path'], 'push')
        for field, value in [('head_sha', 'b' * 40), ('event', 'pull_request_target'), ('path', 'other.yml'),
                             ('status', 'queued'), ('conclusion', 'skipped'), ('conclusion', 'cancelled'),
                             ('conclusion', 'failure'), ('head_repository', {'full_name': 'other/repo'})]:
            candidate = {**run, field: value}
            with self.assertRaises(ValueError):
                validate_run(candidate, SOURCE, run['path'], 'push')


class ArtifactExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / 'out'
        self.output.mkdir()
        self.archive = self.root / 'artifact.zip'

    def write(self, entries):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.archive, 'w') as bundle:
                for name, data in entries:
                    bundle.writestr(name, data)

    def test_only_expected_regular_bytes_are_extracted(self):
        self.write([('report.json', json.dumps({'status': 'passed'}))])
        extract_artifact(self.archive, self.output, {'report.json': 100})
        self.assertEqual(json.loads((self.output / 'report.json').read_text()), {'status': 'passed'})

    def test_unexpected_duplicate_and_traversing_paths_are_rejected(self):
        for entries in [[('extra.py', 'no execution')], [('report.json', 'one'), ('report.json', 'two')],
                        [('../report.json', 'escape')], [('a\\report.json', 'escape')]]:
            with self.subTest(entries=entries):
                self.write(entries)
                with self.assertRaises(ValueError):
                    extract_artifact(self.archive, self.output, {'report.json': 100})
        self.assertEqual(list(self.output.iterdir()), [])

    def test_symlink_and_oversized_members_are_rejected(self):
        link = zipfile.ZipInfo('report.json')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.write([(link, '../../outside')])
        with self.assertRaises(ValueError):
            extract_artifact(self.archive, self.output, {'report.json': 100})
        self.write([('report.json', 'x' * 101)])
        with self.assertRaises(ValueError):
            extract_artifact(self.archive, self.output, {'report.json': 100})

    def test_existing_output_is_never_overwritten(self):
        self.write([('report.json', 'new')])
        (self.output / 'report.json').write_text('original')
        with self.assertRaises(FileExistsError):
            extract_artifact(self.archive, self.output, {'report.json': 100})
        self.assertEqual((self.output / 'report.json').read_text(), 'original')


if __name__ == '__main__':
    unittest.main()
