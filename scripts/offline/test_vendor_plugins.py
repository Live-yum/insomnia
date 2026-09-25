import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import vendor_plugins as vendor


def make_archive(root='package', extra=None):
    stream = io.BytesIO()
    files = [(root + '/package.json', json.dumps({'name': 'example', 'version': '1.0.0'}).encode())]
    files += extra or []
    with tarfile.open(fileobj=stream, mode='w:gz') as archive:
        for name, data in files:
            member = tarfile.TarInfo(name)
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    return stream.getvalue()


class VendorTests(unittest.TestCase):
    def test_exact_catalog_not_readme_urls(self):
        entries = [{'name': 'insomnia-plugin-example-' + str(i)} for i in range(55)]
        body = json.dumps({'props': {'pageProps': {'plugins': entries}}})
        raw = ('<a href="insomnia-plugin-false.git">other</a><script id="__NEXT_DATA__" type="application/json">' + body + '</script>').encode()
        self.assertEqual(vendor.discover(raw), sorted(e['name'] for e in entries))

    def test_incomplete_catalog_rejected(self):
        for raw in (b'', b'<script id="__NEXT_DATA__">{}</script>'):
            with self.subTest(raw=raw), self.assertRaises((ValueError, KeyError)):
                vendor.discover(raw)

    def test_old_and_new_tar_prefixes(self):
        for prefix in ('package', 'node', 'parse-json'):
            with self.subTest(prefix=prefix):
                data = make_archive(prefix)
                self.assertEqual(vendor.archive_info(data)['name'], 'example')
                with tempfile.TemporaryDirectory() as temp:
                    archive = Path(temp) / 'package.tgz'
                    archive.write_bytes(data)
                    vendor.unpack(archive, Path(temp) / 'out')
                    self.assertTrue((Path(temp) / 'out/package.json').is_file())

    def test_integrity(self):
        data = b'archive bytes\r\nare binary\0'
        integrity = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
        vendor.check_integrity(data, integrity)
        with self.assertRaises(ValueError):
            vendor.check_integrity(data.replace(b'\r\n', b'\n'), integrity)

    def test_strongest_integrity_wins(self):
        data = b'actual bytes'
        weak = 'sha1-' + base64.b64encode(hashlib.sha1(data).digest()).decode()
        wrong = 'sha512-' + base64.b64encode(hashlib.sha512(b'wrong').digest()).decode()
        with self.assertRaises(ValueError):
            vendor.check_integrity(data, weak + ' ' + wrong)

    def test_unsafe_paths(self):
        for name in ('../escape', '/absolute', 'package/../escape', 'package/a\\b', 'C:/drive', 'package/a:stream', 'package/\x00bad'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                vendor.safe_parts(name)

    def test_windows_paths(self):
        for name in ('package/CON', 'package/AUX.txt', 'package/foo.', 'package/foo ', 'package/a?b', 'package/com1.exe'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                vendor.safe_parts(name, windows=True)

    def test_traversal_archive_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'bad.tgz'
            archive.write_bytes(make_archive(extra=[('package/../../escape', b'bad')]))
            with self.assertRaises(ValueError):
                vendor.unpack(archive, Path(temp) / 'out')
            self.assertFalse((Path(temp) / 'escape').exists())

    def test_duplicate_paths_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'bad.tgz'
            archive.write_bytes(make_archive(extra=[('package/x', b'1'), ('package/x', b'2')]))
            with self.assertRaises(ValueError):
                vendor.unpack(archive, Path(temp) / 'out')

    def test_windows_case_collision_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'bad.tgz'
            archive.write_bytes(make_archive(extra=[('package/Readme', b'1'), ('package/README', b'2')]))
            with self.assertRaises(ValueError):
                vendor.unpack(archive, Path(temp) / 'out', windows=True)

    def test_archive_links_rejected(self):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            member = tarfile.TarInfo('package/escape')
            member.type = tarfile.SYMTYPE
            member.linkname = '../../outside'
            archive.addfile(member)
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / 'bad.tgz'
            file.write_bytes(stream.getvalue())
            with self.assertRaises(ValueError):
                vendor.unpack(file, Path(temp) / 'out')

    def test_registry_allowlist(self):
        for url in ('http://registry.npmjs.org/x', 'https://registry.npmjs.org.evil/x', 'https://u:p@registry.npmjs.org/x', 'file:///tmp/x', 'https://127.0.0.1/x'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                vendor.checked_url(url)

    def test_private_package_is_not_redistributed(self):
        stream = io.BytesIO()
        content = b'{"name":"private-example","version":"1.0.0","private":true}'
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            member = tarfile.TarInfo('package/package.json')
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
        data = stream.getvalue()
        integrity = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
        with patch.object(vendor, 'fetch', return_value=data), self.assertRaisesRegex(ValueError, 'Redistribution'):
            vendor.store_archive('https://registry.npmjs.org/example.tgz', integrity)


if __name__ == '__main__':
    unittest.main()
