import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from collect_playwright_traces import collect, member_name


class PlaywrightTraceArchiveTests(unittest.TestCase):
    def test_cross_platform_member_names(self):
        for index, name in enumerate(('trace: a?b*.zip', 'CON', 'NUL.txt', '../escape', 'a\\b', '中文.zip', 'trailing. '), 1):
            with self.subTest(name=name):
                member = member_name(index, name)
                self.assertRegex(member, r'^files/[0-9]+-[A-Za-z0-9._-]+$')
                self.assertNotIn('/../', member)
                self.assertFalse(member.endswith(('.', ' ')))

    def test_similar_names_cannot_collide(self):
        self.assertNotEqual(member_name(1, 'a:b.zip').casefold(), member_name(2, 'a?b.zip').casefold())

    def test_preserves_bytes_and_original_path_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'traces'
            (source / 'case').mkdir(parents=True)
            payload = b'unchanged trace bytes\x00\r\n'
            (source / 'case' / 'trace.zip').write_bytes(payload)
            result = collect(source, root / 'diagnostics.zip')
            self.assertEqual(result['fileCount'], 1)
            entry = result['files'][0]
            self.assertEqual(entry['originalPath'], 'case/trace.zip')
            self.assertEqual(entry['bytes'], len(payload))
            self.assertEqual(entry['sha256'], hashlib.sha256(payload).hexdigest())
            with zipfile.ZipFile(root / 'diagnostics.zip') as archive:
                self.assertEqual(archive.read(entry['archivePath']), payload)
                self.assertEqual(json.loads(archive.read('MANIFEST.json')), result)
            self.assertEqual((source / 'case' / 'trace.zip').read_bytes(), payload)

    def test_archive_must_not_include_itself(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            with self.assertRaisesRegex(ValueError, 'outside'):
                collect(source, source / 'recursive.zip')

    def test_missing_source_and_existing_output_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'real Playwright'):
                collect(root / 'missing', root / 'output.zip')
            source = root / 'traces'
            source.mkdir()
            output = root / 'existing.zip'
            output.write_bytes(b'keep')
            with self.assertRaisesRegex(ValueError, 'overwrite'):
                collect(source, output)
            self.assertEqual(output.read_bytes(), b'keep')


if __name__ == '__main__':
    unittest.main()
