"""Behavioral tests for fresh extraction; malicious archives never escape the temp root."""
import hashlib
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile

from safe_archive import extract_verified_archive


class SafePortableArchive(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.output = self.base / 'output'
        self.output.mkdir()
        self.payload = b'validated desktop bytes\0\xff'
        self.manifest = {'bin/app': {'bytes': len(self.payload), 'sha256': hashlib.sha256(self.payload).hexdigest()}}

    def tar(self, name='portable/bin/app', payload=None, kind=tarfile.REGTYPE, link=''):
        file = self.base / 'test.tar.gz'
        with tarfile.open(file, 'w:gz') as archive:
            info = tarfile.TarInfo(name)
            info.type = kind
            info.mode = 0o755
            info.linkname = link
            data = self.payload if payload is None else payload
            info.size = len(data) if kind == tarfile.REGTYPE else 0
            archive.addfile(info, io.BytesIO(data) if kind == tarfile.REGTYPE else None)
        return file

    def test_valid_tar_bytes_and_executable_mode(self):
        archive_path = self.tar()
        # The portable TAR must retain POSIX mode metadata on every build host.
        with tarfile.open(archive_path, 'r:gz') as archive:
            self.assertEqual(archive.getmember('portable/bin/app').mode & 0o777, 0o755)
        root = extract_verified_archive(archive_path, self.output, 'portable', self.manifest, False)
        extracted = root / 'bin/app'
        self.assertEqual(extracted.read_bytes(), self.payload)
        self.assertTrue(extracted.is_file())
        # Windows chmod supports the read-only bit, not POSIX execute bits.
        # Still execute the extraction/integrity test there; test the actual
        # executable permission on POSIX rather than skipping the whole case.
        if os.name == 'nt':
            self.assertTrue(extracted.stat().st_mode & 0o200)
        else:
            self.assertEqual(extracted.stat().st_mode & 0o777, 0o755)
            self.assertTrue(os.access(extracted, os.X_OK))

    def test_valid_zip(self):
        file = self.base / 'test.zip'
        with zipfile.ZipFile(file, 'w') as archive:
            archive.writestr('portable/bin/app', self.payload)
        root = extract_verified_archive(file, self.output, 'portable', self.manifest, True)
        self.assertEqual((root / 'bin/app').read_bytes(), self.payload)

    def test_traversal_absolute_backslash_and_drive_paths(self):
        for name in ['../escape', '/tmp/escape', 'portable/../escape', 'portable//bin/app',
                     'portable/./bin/app', 'portable\\bin\\app', 'C:/escape', 'other/bin/app']:
            with self.subTest(name=name), tempfile.TemporaryDirectory(dir=self.base) as out:
                with self.assertRaises(ValueError):
                    extract_verified_archive(self.tar(name=name), Path(out), 'portable', self.manifest, False)
        self.assertFalse((self.base / 'escape').exists())

    def test_modified_bytes_or_lengths_fail(self):
        for data in [b'x' * len(self.payload), b'', self.payload + b'!']:
            with self.subTest(data=data), tempfile.TemporaryDirectory(dir=self.base) as out:
                with self.assertRaises(ValueError):
                    extract_verified_archive(self.tar(payload=data), Path(out), 'portable', self.manifest, False)

    def test_special_entries_and_hardlinks_fail(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory(dir=self.base) as out:
                with self.assertRaises(ValueError):
                    extract_verified_archive(self.tar(kind=kind, link='../../escape'), Path(out), 'portable', self.manifest, False)

    def test_missing_file_fails(self):
        file = self.base / 'empty.zip'
        with zipfile.ZipFile(file, 'w'):
            pass
        with self.assertRaises(ValueError):
            extract_verified_archive(file, self.output, 'portable', self.manifest, True)

    def test_unexpected_file_fails(self):
        with self.assertRaises(ValueError):
            extract_verified_archive(self.tar(name='portable/injected'), self.output, 'portable', self.manifest, False)

    def test_preexisting_destination_is_rejected(self):
        (self.output / 'old').write_text('do not touch', encoding='utf-8')
        with self.assertRaises(ValueError):
            extract_verified_archive(self.tar(), self.output, 'portable', self.manifest, False)
        self.assertEqual((self.output / 'old').read_text(encoding='utf-8'), 'do not touch')

    @unittest.skipIf(os.name == 'nt', 'Portable symlinks are a Linux-only archive feature')
    def test_declared_relative_symlink_is_created_last(self):
        file = self.base / 'linked.tar.gz'
        manifest = {**self.manifest, 'app': {'link': 'bin/app'}}
        with tarfile.open(file, 'w:gz') as archive:
            link = tarfile.TarInfo('portable/app')
            link.type, link.linkname = tarfile.SYMTYPE, 'bin/app'
            archive.addfile(link)
            info = tarfile.TarInfo('portable/bin/app')
            info.size = len(self.payload)
            archive.addfile(info, io.BytesIO(self.payload))
        root = extract_verified_archive(file, self.output, 'portable', manifest, False)
        self.assertTrue((root / 'app').is_symlink())
        self.assertEqual((root / 'app').read_bytes(), self.payload)

    def test_escaping_expected_symlink_is_rejected_before_extraction(self):
        manifest = {**self.manifest, 'link': {'link': '../escape'}}
        with self.assertRaises(ValueError):
            extract_verified_archive(self.tar(), self.output, 'portable', manifest, False)


if __name__ == '__main__':
    unittest.main()
