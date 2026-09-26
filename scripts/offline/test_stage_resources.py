import json
from pathlib import Path
import tempfile
import unittest

from stage_resources import inventory, synchronize


class StagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'
        self.target = self.root / 'target'
        plugin = self.source / '52d2aeb07a6aef97c344/node_modules/insomnia-plugin-os2udb'
        plugin.mkdir(parents=True)
        (plugin / 'package.json').write_text(json.dumps({'name': 'insomnia-plugin-os2udb', 'version': '1.0.0'}), encoding='utf-8')
        (plugin / '.offline-config').write_bytes(b'preserve hidden files\n')
        (plugin / 'LICENSE').write_bytes(b'preserve license bytes\r\n')
        (plugin / 'node_modules/dependency').mkdir(parents=True)
        (plugin / 'node_modules/dependency/package.json').write_bytes(b'{"name":"dependency"}')
        self.target.mkdir()

    def test_preserves_all_bytes_including_hidden_files_and_dependency_manifests(self):
        report = synchronize(self.source, self.target)
        self.assertTrue(report['allSourceFilesPreserved'])
        self.assertEqual(len(report['repairedFiles']), 4)
        self.assertEqual(inventory(self.source), inventory(self.target))

    def test_second_run_is_idempotent(self):
        first = synchronize(self.source, self.target)
        second = synchronize(self.source, self.target)
        self.assertEqual(first['treeSha256'], second['treeSha256'])
        self.assertEqual(second['repairedFiles'], [])

    def test_restores_omitted_and_corrupted_resources(self):
        synchronize(self.source, self.target)
        manifest = self.target / '52d2aeb07a6aef97c344/node_modules/insomnia-plugin-os2udb/package.json'
        manifest.unlink()
        (manifest.parent / 'LICENSE').write_bytes(b'corruption')
        report = synchronize(self.source, self.target)
        self.assertEqual(len(report['repairedFiles']), 2)
        self.assertEqual(inventory(self.source), inventory(self.target))

    def test_rejects_unexpected_packaged_payload(self):
        (self.target / 'unexpected.js').write_bytes(b'not in reviewed source')
        with self.assertRaises(ValueError):
            synchronize(self.source, self.target)

    def test_rejects_empty_and_overlapping_source(self):
        with self.assertRaises(ValueError):
            synchronize(self.target, self.root / 'other')
        with self.assertRaises(ValueError):
            synchronize(self.source, self.source / 'nested')

    def test_rejects_symlink_resources(self):
        link = self.source / 'external-link'
        try:
            link.symlink_to(self.root / 'outside')
        except (OSError, NotImplementedError):
            self.skipTest('Host does not permit creating symlinks')
        with self.assertRaises(ValueError):
            synchronize(self.source, self.target)


if __name__ == '__main__':
    unittest.main()
