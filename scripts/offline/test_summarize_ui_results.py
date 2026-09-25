from pathlib import Path
import tempfile
import unittest

from summarize_ui_results import summarize


class UiReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for shard in range(1, 7):
            self.write(shard, '<testsuite><testcase name="actual test"/></testsuite>')

    def write(self, shard, xml):
        path = self.root / f'junit-results-8-shard-{shard}' / 'test-results.xml'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(xml, encoding='utf-8')

    def result(self, build='success', test='success'):
        return summarize(self.root, '8', build, test)

    def test_requires_all_reports_and_actual_success(self):
        self.assertEqual(self.result()['status'], 'passed')
        for result in ['failure', 'skipped', 'cancelled', '']:
            self.assertEqual(self.result(test=result)['status'], 'failed')
            self.assertEqual(self.result(build=result)['status'], 'failed')
        (self.root / 'junit-results-8-shard-3/test-results.xml').unlink()
        self.assertEqual(self.result()['status'], 'failed')

    def test_failure_error_and_all_skipped_are_not_green(self):
        for tag in ['failure', 'error']:
            self.write(1, f'<testsuite><testcase name="bad"><{tag}>real failure</{tag}></testcase></testsuite>')
            self.assertEqual(self.result()['status'], 'failed')
            self.assertEqual(len(self.result()['failures']), 1)
        for shard in range(1, 7):
            self.write(shard, '<testsuite><testcase><skipped/></testcase></testsuite>')
        self.assertEqual(self.result()['status'], 'failed')
        self.assertEqual(self.result()['skipped'], 6)

    def test_malformed_and_entity_xml_fail_closed(self):
        for value in ['<broken>', '', '<!DOCTYPE x><testsuite/>', '<!ENTITY x "bad"><testsuite/>', '\0']:
            self.write(1, value)
            self.assertEqual(self.result()['status'], 'failed')
            self.assertTrue(self.result()['diagnostics'])


if __name__ == '__main__':
    unittest.main()
