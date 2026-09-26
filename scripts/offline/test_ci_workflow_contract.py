"""Regressions for the read-only portable workflow entrypoint.

These deliberately pin a simple, auditable contract rather than attempting to
implement the full GitHub expression language. Any guard change requires review.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PortableWorkflowContractTests(unittest.TestCase):
    def setUp(self):
        self.workflow = (ROOT / '.github/workflows/offline-build.yml').read_text(encoding='utf-8')
        self.build = (ROOT / '.github/workflows/offline-complete-build.yml').read_text(encoding='utf-8')
        self.complete = self.workflow.split('  complete:\n', 1)[1].split('\n  portable-required:', 1)[0]

    def test_same_repository_and_external_prs_reach_the_same_build(self):
        condition = re.findall(r'^    if: (.+)$', self.complete, re.MULTILINE)
        self.assertEqual(condition, ["github.repository == 'Live-yum/insomnia'"])
        for event, head_repository in [('pull_request', 'Live-yum/insomnia'), ('pull_request', 'contributor/insomnia'), ('push', ''), ('workflow_dispatch', '')]:
            with self.subTest(event=event, head_repository=head_repository):
                # Guard is intentionally independent of event and head repository.
                self.assertNotIn('event_name', condition[0])
                self.assertNotIn('head.repo', condition[0])
        self.assertNotIn('external-pr:', self.workflow)

    def test_pr_uses_the_merge_result_and_includes_ready_for_review(self):
        self.assertIn('  pull_request:\n    branches: [develop]', self.workflow)
        self.assertIn('types: [opened, synchronize, reopened, ready_for_review]', self.workflow)
        self.assertIn('source_sha: ${{ github.sha }}', self.complete)
        self.assertNotIn('pull_request.head.sha', self.complete)
        self.assertNotIn('pull_request_target:', self.workflow)

    def test_pr_cannot_publish_or_inherit_secrets(self):
        self.assertIn('publish: false', self.complete)
        self.assertNotIn('secrets:', self.workflow)
        self.assertNotIn('write', self.complete)
        self.assertIn('permissions:\n  contents: read', self.workflow)
        self.assertNotIn('secrets:', self.build)
        self.assertIn('persist-credentials: false', self.build)

    def test_aggregate_is_not_green_when_required_job_was_skipped(self):
        required = self.workflow.split('  portable-required:\n', 1)[1]
        self.assertIn('needs: complete', required)
        self.assertIn("always() && github.repository == 'Live-yum/insomnia'", required)
        self.assertIn('RESULT: ${{ needs.complete.result }}', required)
        self.assertIn('if [ "$RESULT" != success ]; then', required)
        self.assertIn('exit 1', required)
        self.assertNotIn('continue-on-error', self.workflow)
        self.assertNotIn('continue-on-error', self.build)

    def test_push_and_pull_request_do_not_cancel_each_other(self):
        group = re.findall(r'^  group: (.+)$', self.workflow, re.MULTILINE)
        self.assertEqual(len(group), 1)
        self.assertIn('${{ github.event_name }}', group[0])
        self.assertIn('github.event.pull_request.number || github.ref', group[0])

    def test_both_native_targets_and_runtime_tests_remain(self):
        for value in ['target: windows-x64', 'target: linux-arm64', 'fail-fast: false', 'node scripts/offline/smoke.mjs', 'bash scripts/offline/smoke-linux.sh', './scripts/offline/smoke-windows-wrapper.ps1', 'stage_resources.py', 'package-complete.py']:
            self.assertIn(value, self.build)


if __name__ == '__main__':
    unittest.main()
