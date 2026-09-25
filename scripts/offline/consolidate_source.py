#!/usr/bin/env python3
"""One-time integration on the already merged offline baseline. No plugin execution."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE = '93200ceade08b65289472d66c01a5126a44055a0'
COPIES = [
    'packages/insomnia/src/plugins/offline-catalog.ts',
    'scripts/offline/vendor_plugins.py',
    'scripts/offline/stage_resources.py',
    'scripts/offline/test_stage_resources.py',
    'scripts/offline/test_vendor_plugins.py',
    'scripts/offline/test_vendor_regressions.py',
    'scripts/offline/test_vendor_duplicates.py',
]


def replace(relative, before, after, count=1):
    file = ROOT / relative
    text = file.read_text(encoding='utf-8')
    if text.count(before) != count:
        raise ValueError(f'Review changed source anchor in {relative}: expected {count}, found {text.count(before)}')
    file.write_text(text.replace(before, after), encoding='utf-8', newline='\n')


def main():
    marker = ROOT / 'docs/OFFLINE-CONSOLIDATION.json'
    if marker.exists():
        print('Consolidated source already committed; no build-time source substitutions.')
        return
    subprocess.run(['git', 'fetch', '--no-tags', 'origin', SOURCE], cwd=ROOT, check=True)
    for name in COPIES:
        data = subprocess.check_output(['git', 'show', SOURCE + ':' + name], cwd=ROOT)
        file = ROOT / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
    helper = 'packages/insomnia/src/plugins/offline-catalog.ts'
    replace(helper, "import path from 'node:path';", "import path from 'node:path';\n\nimport { getAppBundlePlugins } from '../common/constants';")
    replace(helper, "    if (entry.status !== 'materialized-unreviewed') continue;", "    if (entry.status !== 'materialized-unreviewed') continue;\n    // Preserve the original archive on disk, but never shadow the reviewed static Crypto bundle.\n    if (getAppBundlePlugins().some(plugin => plugin.name === entry.name)) continue;")
    helper_file = ROOT / helper
    helper_file.write_text(helper_file.read_text(encoding='utf-8') + '\nexport function isOfflineCatalogPluginDirectory(directory: string): boolean {\n  const normalized = path.resolve(directory);\n  const names = readCatalogDirectories().get(path.dirname(normalized));\n  return names?.includes(path.basename(normalized)) ?? false;\n}\n', encoding='utf-8')
    loader = 'packages/insomnia/src/plugins/index.ts'
    replace(loader, "import themes from './themes';", "import { getOfflinePluginDirectories, isOfflineCatalogPluginDirectory, readPluginDirectory } from './offline-catalog';\nimport themes from './themes';")
    text = (ROOT / loader).read_text(encoding='utf-8')
    occurrences = text.count('fs.readdirSync(p)')
    if occurrences != 2:
        raise ValueError('Expected exactly two plugin directory enumerators')
    replace(loader, 'fs.readdirSync(p)', 'readPluginDirectory(p)', 2)
    replace(loader, 'const allPaths = [...basePaths, ...extendedPaths];', 'const allPaths = [...basePaths, ...extendedPaths, ...getOfflinePluginDirectories()];')
    original_config = 'const config = pluginJson.name in allConfigs ? allConfigs[pluginJson.name] : { disabled: false };'
    replacement_config = 'const config = pluginJson.name in allConfigs ? allConfigs[pluginJson.name] : { disabled: isOfflineCatalogPluginDirectory(modulePath) };'
    replace(loader, original_config, replacement_config)
    # Disabled entries do not run code. Keep historical user-installed plugin behavior;
    # every community entry shipped by this distribution defaults to disabled.
    replace(loader, "        let module: Plugin['module'];\n        if (shouldSandboxPlugin(settings, { directory: modulePath, config })) {", "        let module: Plugin['module'];\n        if (config.disabled) {\n          module = {};\n        } else if (shouldSandboxPlugin(settings, { directory: modulePath, config })) {")
    # Rechecking all 545 dependency trees for each inert entry is quadratic. A
    # disabled catalog entry grants no execution/trust, so only activation needs
    # the second race-sensitive duplicate scan. The initial scan remains intact.
    replace(loader, '        if ((await findDuplicatePluginNames(allPaths)).has(pluginName)) {', "        if ((!isOfflineCatalogPluginDirectory(modulePath) || allConfigs[pluginName]?.disabled === false) &&\n          (await findDuplicatePluginNames(allPaths)).has(pluginName)) {")
    config = 'packages/insomnia/electron-builder.offline.cjs'
    replace(config, "extraResources: [{ from: './src/vendor', to: './offline-plugins', filter: ['**/*'] }],", "extraResources: [\n    { from: './src/vendor', to: './offline-reviewed-sources', filter: ['**/*'] },\n    { from: './offline-plugin-resources', to: './offline-plugins', filter: ['**/*', '**/.*'] },\n  ],")
    smoke = 'scripts/offline/smoke.mjs'
    replace(smoke, "import assert from 'node:assert/strict';", "import assert from 'node:assert/strict';\nimport { verifyCompleteSmoke } from './verify-complete-smoke.mjs';")
    replace(smoke, "  assert.equal(page.url(), projectUrl);", "  assert.equal(page.url(), projectUrl);\n  await verifyCompleteSmoke(app, page);")
    replace(smoke, "delete env.INSOMNIA_SESSION;", "delete env.INSOMNIA_SESSION;\ndelete env.INSOMNIA_OFFLINE_PLUGIN_DIR;\nfor (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN']) delete env[key];")
    (ROOT / '.github/workflows/offline-build.yml').write_text('''name: Offline portable build
on:
  push:
    branches: [offline/complete-portable, develop]
  pull_request:
    branches: [develop]
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: offline-complete-${{ github.event_name }}-${{ github.head_ref || github.ref_name }}
  cancel-in-progress: true
jobs:
  complete:
    if: github.repository == 'Live-yum/insomnia' && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name != github.repository)
    uses: ./.github/workflows/offline-complete-build.yml
    with:
      source_sha: ${{ github.sha }}
      publish: ${{ github.ref == 'refs/heads/develop' && github.event_name == 'push' }}
    permissions:
      contents: write
''', encoding='utf-8')
    # Keep npm snapshot refreshing opt-in; a build must never refresh versions.
    snapshot = ROOT / '.github/workflows/offline-plugin-snapshot.yml'
    snapshot.write_bytes(subprocess.check_output(['git', 'show', SOURCE + ':.github/workflows/offline-plugin-snapshot.yml'], cwd=ROOT))
    formatted = ['src/plugins/index.ts', 'src/plugins/offline-catalog.ts']
    subprocess.run(['node', str(ROOT / 'node_modules/eslint/bin/eslint.js'), '--fix', *formatted], cwd=ROOT / 'packages/insomnia', check=True)
    record = {'base': 'e81df4a041a79a4c3f9e5f77a000c7b4f9f56883', 'selectedCatalogSource': SOURCE,
              'preservedReviewedCrypto': True, 'runtimeValidated': False,
              'copiedPaths': COPIES, 'files': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in COPIES}}
    marker.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    paths = COPIES + [loader, config, smoke, '.github/workflows/offline-build.yml', '.github/workflows/offline-plugin-snapshot.yml', 'docs/OFFLINE-CONSOLIDATION.json']
    subprocess.run(['git', 'add', '--force', '--', *paths], cwd=ROOT, check=True)
    subprocess.run(['git', 'diff', '--cached', '--check'], cwd=ROOT, check=True)
    print('Consolidation changed only selected source paths:')
    subprocess.run(['git', 'diff', '--cached', '--stat'], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
