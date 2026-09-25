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


class SnapshotRegressionTests(unittest.TestCase):
    def test_metadata_readers_use_explicit_utf8(self):
        import ast
        root = Path(__file__).resolve().parent
        for name in ('vendor_plugins.py', 'package-complete.py', 'stage_resources.py'):
            tree = ast.parse((root / name).read_bytes().decode('utf-8'))
            readers = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                       and isinstance(node.func, ast.Attribute) and node.func.attr == 'read_text']
            self.assertTrue(readers)
            for reader in readers:
                with self.subTest(file=name, line=reader.lineno):
                    self.assertTrue(any(keyword.arg == 'encoding' and isinstance(keyword.value, ast.Constant)
                                        and keyword.value.value in ('utf-8', 'utf-8-sig') for keyword in reader.keywords))

    def test_lock_packages_ignore_json_key_order(self):
        packages = {
            'node_modules/foo/node_modules/a': {'resolved': 'https://registry.npmjs.org/a/-/a-1.tgz', 'integrity': 'sha512-YQ=='},
            'node_modules/foo-a': {'resolved': 'https://registry.npmjs.org/foo-a/-/foo-a-1.tgz', 'integrity': 'sha512-Yg=='},
            'node_modules/foo': {'resolved': 'https://registry.npmjs.org/foo/-/foo-1.tgz', 'integrity': 'sha512-Yw=='},
        }
        before = {'packages': packages}
        after = json.loads(json.dumps(before, sort_keys=True))
        self.assertEqual(vendor.lock_packages(before), vendor.lock_packages(after))
        after['packages']['node_modules/foo']['integrity'] = 'sha512-ZA=='
        self.assertNotEqual(vendor.lock_packages(before), vendor.lock_packages(after))

    def test_corrupt_content_addressed_cache_is_replaced(self):
        buffer = io.BytesIO()
        contents = b'{"name":"example","version":"1.0.0","license":"MIT"}'
        with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
            member = tarfile.TarInfo('package/package.json')
            member.size = len(contents)
            archive.addfile(member, io.BytesIO(contents))
        data = buffer.getvalue()
        digest = hashlib.sha256(data).hexdigest()
        integrity = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'blobs' / (digest + '.tgz')
            archive.parent.mkdir()
            archive.write_bytes(b'damaged by an old text conversion')
            with patch.object(vendor, 'VENDOR', root), patch.object(vendor, 'fetch', return_value=data):
                record = vendor.store_archive('https://registry.npmjs.org/example/-/example-1.tgz', integrity)
                self.assertEqual(vendor.read_archive(record), data)


if __name__ == '__main__':
    unittest.main()
