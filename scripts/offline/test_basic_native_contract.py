"""Basic becomes the default without dropping required native/security checks."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class BasicNativeContract(unittest.TestCase):
    def test_compact_is_default_and_full_is_opt_in(self):
        workflow = (ROOT / '.github/workflows/offline-complete-build.yml').read_text(encoding='utf-8')
        self.assertIn('default: basic', workflow)
        self.assertIn("if: inputs.edition == 'full'", workflow)
        self.assertIn('config=electron-builder.basic.cjs', workflow)
        self.assertIn('python scripts/offline/package-basic.py', workflow)
        self.assertNotIn('continue-on-error', workflow)

    def test_final_archive_is_extracted_and_all_bytes_are_compared(self):
        source = (ROOT / 'scripts/offline/package-basic.py').read_text(encoding='utf-8')
        for evidence in ('tree_manifest(extracted) != manifest', "budget_report('archive'", 'freshExtractionSeconds',
                         'windows-wrapper.json', 'noCommunityPluginPayload', 'sourceCommit'):
            self.assertIn(evidence, source)

    def test_fresh_profile_must_not_load_community_payload(self):
        source = (ROOT / 'scripts/offline/verify-basic-smoke.mjs').read_text(encoding='utf-8')
        self.assertIn("code: 'ENOENT'", source)
        self.assertIn('inventory.all.map', source)
        self.assertIn('network.sendRequestWithoutSideEffects', source)
        self.assertIn('requests, before + 1', source)


if __name__ == '__main__':
    unittest.main()
