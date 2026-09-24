#!/usr/bin/env python3
"""Apply narrow, idempotent source fixes found by the actual offline CI run.

Only application-owned files are edited. Never imports or executes a downloaded
plugin. Formatting uses the repository's existing, lockfile-pinned ESLint rules.
"""
from __future__ import annotations

import hashlib
import json
import os
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
    subprocess.run(
        ['node', str(ROOT / 'node_modules/eslint/bin/eslint.js'), '--fix', *FORMAT_FILES],
        cwd=APP, check=True,
    )
    # Refresh integration provenance only for source bytes. These records must not
    # claim packaged runtime/network validation merely because formatting passed.
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
    permitted.update({'docs/OFFLINE-PLUGIN-LOADER-STATUS.json', 'docs/OFFLINE-SOURCE-STATUS.json'})
    changed = set(subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT, text=True).splitlines())
    if not changed <= permitted:
        raise ValueError('Unexpected modified files: ' + repr(sorted(changed - permitted)))
    subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)
    print('Reviewed source repairs:', len(changed), 'files; no plugin entrypoints executed.')


if __name__ == '__main__':
    main()
