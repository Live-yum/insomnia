"""Prevent regressions in reviewed CI runtimes and warning gates."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
PINS = {
    'actions/upload-artifact': '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    'actions/download-artifact': '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
}


class WarningContractTests(unittest.TestCase):
    def test_direct_artifact_actions_are_pinned_to_reviewed_node24_versions(self):
        count = 0
        for file in sorted((ROOT / '.github').rglob('*')):
            if file.suffix not in {'.yml', '.yaml'}:
                continue
            for action, ref in re.findall(r'^\s*(?:-\s*)?uses:\s*(actions/(?:upload|download)-artifact)@([^\s#]+)', file.read_text(encoding='utf-8'), re.MULTILINE):
                with self.subTest(path=str(file.relative_to(ROOT)), action=action):
                    self.assertEqual(ref, PINS[action])
                count += 1
        self.assertGreater(count, 10)

    def test_sast_composite_transitive_node24_upgrade_remains_pinned(self):
        source = (ROOT / '.github/workflows/sast.yml').read_text(encoding='utf-8')
        self.assertIn('Kong/public-shared-actions/security-actions/semgrep@a92df3beb1e69e27d86be56346488f15fecaf0de', source)
        self.assertNotIn('a18abf762d6e2444bcbfd20de70451ea1e3bc1b1', source)

    def test_warning_budget_and_cli_suite_are_required_in_portable_quality(self):
        source = (ROOT / '.github/workflows/offline-complete-build.yml').read_text(encoding='utf-8')
        self.assertIn('npm run lint --workspaces --if-present -- --max-warnings=0', source)
        self.assertIn('--no-cache --max-warnings=0 packages/insomnia-smoke-test/tests', source)
        self.assertIn('npm run test:unit -w insomnia-inso', source)
        self.assertIn('npm run check-cycle-references', source)
        self.assertNotIn('continue-on-error', source)
        config = (ROOT / 'eslint.config.mjs').read_text(encoding='utf-8')
        self.assertIn("'playwright/prefer-locator': 'error'", config)

    def test_unused_blanket_disable_is_not_regenerated(self):
        source = (ROOT / 'packages/insomnia/scripts/sandbox-vendored-lib.ts').read_text(encoding='utf-8')
        self.assertNotIn('`/* eslint-disable */`', source)
        for name in ['ajv', 'uuid']:
            file = ROOT / f'packages/insomnia/src/templating/sandbox/vendored/{name}.generated.ts'
            self.assertNotIn('/* eslint-disable */', '\n'.join(file.read_text(encoding='utf-8').splitlines()[:6]))


if __name__ == '__main__':
    unittest.main()
