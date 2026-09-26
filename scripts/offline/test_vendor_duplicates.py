"""Regression coverage for legacy npm archives with repeated regular members."""
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

import vendor_plugins as vendor


def archive_bytes(entries):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w:gz') as archive:
        for name, contents, mode in entries:
            member = tarfile.TarInfo('package/' + name)
            member.size = len(contents)
            member.mode = mode
            archive.addfile(member, io.BytesIO(contents))
    return data.getvalue()


class LegacyDuplicateTests(unittest.TestCase):
    def extract(self, entries, windows=False):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        package = root / 'archive.tgz'
        package.write_bytes(archive_bytes(entries))
        destination = root / 'out'
        vendor.unpack(package, destination, windows=windows)
        return destination

    def test_identical_repeated_members_are_losslessly_coalesced(self):
        for windows in (False, True):
            with self.subTest(windows=windows):
                root = self.extract([
                    ('index.js', b'module.exports = 42;\r\n', 0o644),
                    ('LICENSE', b'license\n', 0o644),
                    ('index.js', b'module.exports = 42;\r\n', 0o644),
                ], windows)
                self.assertEqual((root / 'index.js').read_bytes(), b'module.exports = 42;\r\n')
                self.assertEqual(sorted(p.name for p in root.iterdir()), ['LICENSE', 'index.js'])

    def test_conflicting_bytes_are_not_last_entry_wins(self):
        with self.assertRaisesRegex(ValueError, 'Conflicting duplicate'):
            self.extract([('x', b'first', 0o644), ('x', b'other', 0o644)])

    def test_conflicting_executable_permissions_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Conflicting duplicate'):
            self.extract([('x', b'content', 0o644), ('x', b'content', 0o755)])

    def test_case_collision_is_rejected_even_with_identical_bytes(self):
        with self.assertRaisesRegex(ValueError, 'Conflicting duplicate'):
            self.extract([('Readme', b'content', 0o644), ('README', b'content', 0o644)], windows=True)

    def test_repeated_empty_file_is_preserved(self):
        root = self.extract([('empty', b'', 0o644), ('empty', b'', 0o644)])
        self.assertTrue((root / 'empty').is_file())
        self.assertEqual((root / 'empty').stat().st_size, 0)


if __name__ == '__main__':
    unittest.main()
