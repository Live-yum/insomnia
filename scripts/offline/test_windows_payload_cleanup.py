import os
from pathlib import Path
import tempfile
import unittest

from windows_payload_cleanup import cleanup_windows_test_payload


class WindowsPayloadCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'Insomnia.exe').write_bytes(b'wrapper-entry')
        (self.root / 'insomnia.dll').write_bytes(b'preserved-native-payload')

    def copy(self, name):
        (self.root / name).write_bytes((self.root / 'insomnia.dll').read_bytes())

    def test_only_exact_known_identical_copies_are_removed(self):
        self.copy('Insomnia-origin-13.3.0.exe')
        self.copy('insomnia-13.3.0.exe')
        self.copy('insomnia-13.2.0.exe')
        (self.root / 'unrelated.exe').write_bytes(b'user file')
        report = cleanup_windows_test_payload(self.root, '13.3.0')
        self.assertEqual({item['path'] for item in report}, {'Insomnia-origin-13.3.0.exe', 'insomnia-13.3.0.exe'})
        self.assertEqual((self.root / 'Insomnia.exe').read_bytes(), b'wrapper-entry')
        self.assertEqual((self.root / 'insomnia.dll').read_bytes(), b'preserved-native-payload')
        self.assertEqual((self.root / 'unrelated.exe').read_bytes(), b'user file')
        self.assertTrue((self.root / 'insomnia-13.2.0.exe').is_file())
        self.assertEqual(cleanup_windows_test_payload(self.root, '13.3.0'), [])

    def test_mismatched_copy_stops_without_deleting_other_files(self):
        self.copy('Insomnia-origin-13.3.0.exe')
        (self.root / 'insomnia-13.3.0.exe').write_bytes(b'corrupt')
        with self.assertRaises(ValueError):
            cleanup_windows_test_payload(self.root, '13.3.0')
        self.assertTrue((self.root / 'Insomnia-origin-13.3.0.exe').exists())
        self.assertEqual((self.root / 'insomnia-13.3.0.exe').read_bytes(), b'corrupt')

    def test_directory_and_nsis_install_are_not_removed(self):
        (self.root / 'insomnia-13.3.0.exe').mkdir()
        with self.assertRaises(ValueError):
            cleanup_windows_test_payload(self.root, '13.3.0')
        (self.root / 'insomnia-13.3.0.exe').rmdir()
        self.copy('insomnia-13.3.0.exe')
        (self.root / 'installer-info.json').write_text('{}', encoding='utf-8')
        with self.assertRaises(ValueError):
            cleanup_windows_test_payload(self.root, '13.3.0')
        self.assertTrue((self.root / 'insomnia-13.3.0.exe').exists())

    def test_missing_payload_and_unsafe_version_fail(self):
        for version in ['../13.3.0', '13/3/0', '13.3.0\n', '', '13.3.0;rm']:
            with self.assertRaises(ValueError):
                cleanup_windows_test_payload(self.root, version)
        (self.root / 'insomnia.dll').unlink()
        with self.assertRaises(ValueError):
            cleanup_windows_test_payload(self.root, '13.3.0')

    @unittest.skipIf(os.name == 'nt', 'Unprivileged Windows runners do not create POSIX symlinks')
    def test_linked_test_copy_cannot_delete_an_external_file(self):
        outside = self.root / 'outside'
        outside.write_bytes(b'preserved-native-payload')
        (self.root / 'insomnia-13.3.0.exe').symlink_to(outside)
        with self.assertRaises(ValueError):
            cleanup_windows_test_payload(self.root, '13.3.0')
        self.assertTrue(outside.exists())


if __name__ == '__main__':
    unittest.main()
