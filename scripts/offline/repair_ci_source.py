#!/usr/bin/env python3
"""Commit full-suite-tested offline test fixtures; do not change runtime policy.

The ordinary portable build never invokes this one-time source migration.
"""
from __future__ import annotations

from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'packages/insomnia'
FORMAT_FILES = [
    'src/common/__tests__/insomnia-fetch.test.ts',
    'src/main/__tests__/bundle-spectral-ruleset.test.ts',
    'src/main/__tests__/bundle-spectral-offline.test.ts',
    'src/plugins/__tests__/index.test.ts',
    'src/plugins/__tests__/plugin-load-order-quickjs-module-resolution.test.ts',
    'src/ui/utils/router.test.ts',
]


def replace(relative: str, before: str, after: str) -> None:
    target = APP / relative
    text = target.read_text(encoding='utf-8')
    if after in text:
        return
    if relative == 'src/main/__tests__/bundle-spectral-ruleset.test.ts' and 'importOriginal<typeof OfflinePolicy>()' in text:
        return
    if text.count(before) != 1:
        raise ValueError('Source changed; review anchor: ' + relative)
    target.write_text(text.replace(before, after, 1), encoding='utf-8', newline='\n')


def main() -> None:
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip():
        raise ValueError('Repair requires a clean checkout')
    # The service SDK supports five HTTP methods; the generic proxy entry point
    # is tested separately. Do not widen production types for test fixtures.
    replace('src/common/__tests__/insomnia-fetch.test.ts',
            "['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const",
            "['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const")
    # Preserve the independently committed archive extraction repair.
    replace(
        'src/main/__tests__/bundle-spectral-ruleset.test.ts',
        '// Mock fs and dns so no real files or DNS lookups are needed.',
        "import type * as OfflinePolicy from '~/common/offline-policy';\n\n"
        "// Historical online-branch protections remain tested with inert network mocks.\n"
        "// bundle-spectral-offline.test.ts independently tests the real offline flag.\n"
        "vi.mock('~/common/offline-policy', async importOriginal => ({\n"
        "  ...(await importOriginal<typeof OfflinePolicy>()),\n"
        "  OFFLINE_BUILD: false,\n"
        "}));\n\n"
        '// Mock fs and dns so no real files or DNS lookups are needed.',
    )
    replace('src/plugins/__tests__/index.test.ts',
            "import { getAppBundlePlugins } from '~/common/constants';",
            "import * as appConstants from '~/common/constants';")
    replace('src/plugins/__tests__/index.test.ts',
            'afterEach(() => {\n  _testOnlySetPlugins(null);\n});',
            'afterEach(() => {\n  vi.restoreAllMocks();\n  _testOnlySetPlugins(null);\n});')
    replace('src/plugins/__tests__/index.test.ts',
            '    const bundlePluginName = getAppBundlePlugins()[0].name;',
            "    const bundlePluginName = 'insomnia-plugin-test-bundle';\n"
            "    vi.spyOn(appConstants, 'getAppBundlePlugins').mockReturnValue([{ name: bundlePluginName }]);")
    replace('src/plugins/__tests__/plugin-load-order-quickjs-module-resolution.test.ts',
            '      pluginConfig: { [elevatedPluginName]: { disabled: false, elevated: true } },',
            '      pluginConfig: {\n'
            '        [elevatedPluginName]: { disabled: false, elevated: true },\n'
            '        [sandboxedPluginName]: { disabled: false },\n'
            '      },')
    replace('src/plugins/__tests__/plugin-load-order-quickjs-module-resolution.test.ts',
            '    // Sorts second; left in the default sandboxed mode.',
            '    // Explicitly enabled test fixture; still uses the default sandboxed mode.')
    subprocess.run(['node', str(ROOT / 'node_modules/eslint/bin/eslint.js'), '--fix', *FORMAT_FILES], cwd=APP, check=True)
    permitted = {'packages/insomnia/' + item for item in FORMAT_FILES}
    changed = set(subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT, text=True).splitlines())
    if not changed <= permitted:
        raise ValueError('Unexpected source changes: ' + repr(sorted(changed - permitted)))
    subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)
    print('Reviewed test source repairs:', sorted(changed), flush=True)


if __name__ == '__main__':
    main()
