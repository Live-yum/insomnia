#!/usr/bin/env python3
"""Apply narrow, idempotent source fixes found by the actual offline CI run.

Only application-owned files are edited. Never imports or executes a downloaded
plugin. Formatting uses the repository's existing, lockfile-pinned ESLint rules.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'packages/insomnia'
FORMAT_FILES = [
    'scripts/verify-bundle-plugins.ts',
    'src/common/constants.ts',
    'src/common/offline-policy.ts',
    'src/common/__tests__/offline-origin-policy.test.ts',
    'src/entry.main.ts',
    'src/main/bundle-spectral-ruleset.ts',
    'src/main/ipc/main.ts',
    'src/main/offline-network.ts',
    'src/main/window-utils.ts',
    'src/plugins/index.ts',
    'src/root.tsx',
    'src/routes/organization.$organizationId.project.$projectId.delete.tsx',
    'src/routes/organization.tsx',
]
ENCODING_FILES = {
    'scripts/offline/vendor_plugins.py': 5,
    'scripts/offline/package_portable.py': 1,
}
ENCODING_TEST = '''    def test_metadata_readers_use_explicit_utf8(self):
        import ast
        root = Path(__file__).resolve().parent
        for name in ('vendor_plugins.py', 'package_portable.py'):
            tree = ast.parse((root / name).read_bytes().decode('utf-8'))
            readers = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                       and isinstance(node.func, ast.Attribute) and node.func.attr == 'read_text']
            self.assertTrue(readers)
            for reader in readers:
                with self.subTest(file=name, line=reader.lineno):
                    self.assertTrue(any(keyword.arg == 'encoding' and isinstance(keyword.value, ast.Constant)
                                        and keyword.value.value == 'utf-8' for keyword in reader.keywords))

'''


def replace_once(relative: str, before: str, after: str) -> None:
    target = APP / relative
    text = target.read_text(encoding='utf-8')
    if after in text and before not in text:
        return
    if text.count(before) != 1:
        raise ValueError(f'Source changed; review the repair anchor in {relative}')
    target.write_text(text.replace(before, after, 1), encoding='utf-8', newline='\n')


def main() -> None:
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip():
        raise ValueError('Repair requires a clean checkout')
    replace_once(
        'src/common/constants.ts',
        'export const getAppBundlePlugins = () => appConfig.bundlePlugins;',
        'export const getAppBundlePlugins = (): { name: string }[] => appConfig.bundlePlugins;',
    )
    replace_once(
        'scripts/verify-bundle-plugins.ts',
        "import { bundlePlugins } from '../config/config.json';",
        "import appConfig from '../config/config.json';\n\nconst bundlePlugins: { name: string }[] = appConfig.bundlePlugins;",
    )
    replace_once(
        'src/common/offline-policy.ts',
        "    const code = character.charCodeAt(0);\n    return code <= 32 || code === 127 || character === '\\\\';",
        "    const code = character.codePointAt(0);\n    return (code !== undefined && code <= 32) || code === 127 || character === '\\\\';",
    )
    replace_once(
        'src/common/__tests__/offline-origin-policy.test.ts',
        'String.fromCharCode(code)',
        'String.fromCodePoint(code)',
    )
    # Windows Python 3.12 defaults to a legacy code page. The catalog, lockfiles
    # and npm package manifests are UTF-8 regardless of the machine's locale.
    for relative, expected_count in ENCODING_FILES.items():
        target = ROOT / relative
        text = target.read_text(encoding='utf-8')
        count = text.count('.read_text()')
        if count not in (0, expected_count):
            raise ValueError('Unexpected metadata readers in ' + relative)
        if count:
            target.write_text(text.replace('.read_text()', ".read_text(encoding='utf-8')"), encoding='utf-8', newline='\n')
    tests = ROOT / 'scripts/offline/test_vendor_regressions.py'
    text = tests.read_text(encoding='utf-8')
    if 'def test_metadata_readers_use_explicit_utf8' not in text:
        anchor = 'class SnapshotRegressionTests(unittest.TestCase):\n'
        if text.count(anchor) != 1:
            raise ValueError('Unexpected regression test structure')
        tests.write_text(text.replace(anchor, anchor + ENCODING_TEST, 1), encoding='utf-8', newline='\n')
    subprocess.run(
        ['node', str(ROOT / 'node_modules/eslint/bin/eslint.js'), '--fix', *FORMAT_FILES],
        cwd=APP, check=True,
    )
    marker = ROOT / 'docs/OFFLINE-PLUGIN-LOADER-STATUS.json'
    if marker.exists():
        record = json.loads(marker.read_text(encoding='utf-8'))
        record['sha256'] = hashlib.sha256((APP / 'src/plugins/index.ts').read_bytes()).hexdigest()
        record['runtimeValidated'] = False
        marker.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    status = ROOT / 'docs/OFFLINE-SOURCE-STATUS.json'
    if status.exists():
        record = json.loads(status.read_text(encoding='utf-8'))
        for item in record['files']:
            item['sha256'] = hashlib.sha256((ROOT / item['path']).read_bytes()).hexdigest()
        record['buildValidated'] = False
        status.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    permitted = {'packages/insomnia/' + name for name in FORMAT_FILES}
    permitted.update(ENCODING_FILES)
    permitted.update({'scripts/offline/test_vendor_regressions.py', 'docs/OFFLINE-PLUGIN-LOADER-STATUS.json', 'docs/OFFLINE-SOURCE-STATUS.json'})
    changed = set(subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT, text=True).splitlines())
    if not changed <= permitted:
        raise ValueError('Unexpected modified files: ' + repr(sorted(changed - permitted)))
    subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)
    print('Reviewed source repairs:', len(changed), 'files; no plugin entrypoints executed.')


if __name__ == '__main__':
    main()
