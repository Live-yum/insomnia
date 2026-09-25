#!/usr/bin/env python3
"""Verify previously committed test migrations without modifying build inputs.

All source fixes were committed in 6d43d0fee20edb2d56255470233fd5edd42e9972.
The following workflow steps still require full workspace lint/unit tests,
application type checking/build and archive regression tests. This is not a
substitute for those tests and never executes third-party plugin entrypoints.
"""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'packages/insomnia'


def main() -> None:
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip():
        raise ValueError('Validation requires a clean source checkout')
    checks = {
        'src/plugins/__tests__/index.test.ts': ['bundlePluginSpy?.mockRestore()', 'insomnia-plugin-test-bundle'],
        'src/ui/utils/router.test.ts': ['toHaveBeenCalledExactlyOnceWith', "parentId: 'org_offline'"],
        'src/main/__tests__/bundle-spectral-ruleset.test.ts': ['importOriginal<typeof OfflinePolicy>()', 'OFFLINE_BUILD: false'],
        'src/main/__tests__/bundle-spectral-offline.test.ts': ['expect(OFFLINE_BUILD).toBe(true)', 'expect(dns.lookup).not.toHaveBeenCalled()'],
        'src/plugins/__tests__/plugin-load-order-quickjs-module-resolution.test.ts': ['[sandboxedPluginName]: { disabled: false }'],
        'src/common/__tests__/insomnia-fetch.test.ts': ['OFFLINE_SERVICE_ERROR', 'expect(fetch).not.toHaveBeenCalled()'],
    }
    for name, anchors in checks.items():
        content = (APP / name).read_text(encoding='utf-8')
        for anchor in anchors:
            if anchor not in content:
                raise ValueError('Expected committed migration is missing: ' + name)
    subprocess.run(['git', 'diff', '--exit-code'], cwd=ROOT, check=True)
    print('Source migrations already committed; no test or application bytes modified.', flush=True)


if __name__ == '__main__':
    main()
