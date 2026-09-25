#!/usr/bin/env python3
"""Apply narrow, reviewable quality repairs; never edit or execute catalog plugin code."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'packages/insomnia'
FORMAT = [
    'src/common/offline-policy.ts', 'src/entry.main.ts', 'src/main/bundle-spectral-ruleset.ts',
    'src/main/ipc/main.ts', 'src/main/offline-network.ts', 'src/main/templating-worker-database.ts',
    'src/main/window-utils.ts', 'src/root.tsx',
    'src/routes/organization.$organizationId.project.$projectId.delete.tsx', 'src/routes/organization.tsx',
    'src/main/__tests__/bundle-spectral-ruleset.test.ts', 'src/main/__tests__/bundle-spectral-offline.test.ts',
    'src/ui/utils/router.test.ts', 'src/ui/utils/router-offline.test.ts',
    'src/common/__tests__/insomnia-fetch.test.ts',
]


def replace(file, before, after):
    text = file.read_text(encoding='utf-8')
    if after in text:
        return
    if text.count(before) != 1:
        raise ValueError('Review changed source anchor: ' + str(file))
    file.write_text(text.replace(before, after), encoding='utf-8', newline='\n')


def main():
    policy = APP / 'src/common/offline-policy.ts'
    replace(policy, r'/[\u0000-\u0020\u007f\\]/.test(item)', "Array.from(item).some(character => {\n        const code = character.codePointAt(0);\n        return (code !== undefined && code <= 32) || code === 127 || character === '\\\\';\n      })")
    spectral = APP / 'src/main/__tests__/bundle-spectral-ruleset.test.ts'
    before = '// Mock fs and dns so no real files or DNS lookups are needed.'
    after = "// Preserve all legacy SSRF cases using a test-only flag override.\n// Production remains OFFLINE_BUILD=true, tested independently in bundle-spectral-offline.test.ts.\nvi.mock('~/common/offline-policy', async importOriginal => ({\n  ...await importOriginal<Record<string, unknown>>(),\n  OFFLINE_BUILD: false,\n}));\n\n" + before
    replace(spectral, before, after)
    tests_source = '387e05087bd4c577fc8e6c9a8a829da86f28174e'
    subprocess.run(['git', 'fetch', '--no-tags', 'origin', tests_source], cwd=ROOT, check=True)
    spectral_offline = 'packages/insomnia/src/main/__tests__/bundle-spectral-offline.test.ts'
    target = ROOT / spectral_offline
    if not target.exists():
        target.write_bytes(subprocess.check_output(['git', 'show', tests_source + ':' + spectral_offline], cwd=ROOT))
    router = APP / 'src/ui/utils/router.test.ts'
    before = "vi.mock('insomnia-data', async importOriginal => {"
    after = "// These original cloud-route fixtures are retained as regression tests for the dormant branch.\n// router-offline.test.ts separately checks real account-free startup and local persistence.\nvi.mock('~/common/offline', async importOriginal => ({\n  ...await importOriginal<Record<string, unknown>>(),\n  OFFLINE_BUILD: false,\n}));\n\n" + before
    replace(router, before, after)
    # The host requires CommonJS plugin entrypoints. Preserve original vendor bytes
    # and declare only used environment names, not Buffer/crypto as script globals.
    config = ROOT / 'eslint.config.mjs'
    before = '  // Test files ESLint rules'
    after = """  // These reviewed entrypoints must remain CommonJS for the plugin host and builder.
  {
    files: [
      'packages/insomnia/electron-builder.offline.cjs',
      'packages/insomnia/src/vendor/insomnia-plugin-crypto/**/*.js',
      'packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools/*.cjs',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'readonly', console: 'readonly' },
    },
    rules: { 'unicorn/prefer-module': 'off' },
  },
  {
    // Preserve the upstream snapshot SHA256; these are spelling/format preferences only.
    files: ['packages/insomnia/src/vendor/insomnia-plugin-crypto/**/*.js'],
    rules: {
      'unicorn/prefer-node-protocol': 'off',
      'unicorn/prefer-number-properties': 'off',
      'unicorn/numeric-separators-style': 'off',
      'unicorn/text-encoding-identifier-case': 'off',
    },
  },
""" + before
    replace(config, before, after)
    subprocess.run(['node', str(ROOT / 'node_modules/eslint/bin/eslint.js'), '--fix', *FORMAT], cwd=APP, check=True)
    subprocess.run(['git', 'add', '--', 'eslint.config.mjs', *['packages/insomnia/' + f for f in FORMAT]], cwd=ROOT, check=True)
    subprocess.run(['git', 'diff', '--cached', '--check'], cwd=ROOT, check=True)
    subprocess.run(['git', 'diff', '--cached', '--stat'], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
