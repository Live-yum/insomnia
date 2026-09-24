#!/usr/bin/env python3
"""One-time reviewed integration; commit its outputs. Not invoked by normal builds."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def replace(path, old, new):
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    if new in text and old not in text:
        return
    if text.count(old) != 1:
        raise RuntimeError('Integration anchor drift: ' + path)
    target.write_text(text.replace(old, new), encoding='utf-8')

def section(path, start, end, replacement):
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    if replacement in text:
        return
    if text.count(start) != 1 or text.count(end) != 1:
        raise RuntimeError('Integration section drift: ' + path)
    a, b = text.index(start), text.index(end)
    if a >= b:
        raise RuntimeError('Invalid integration section')
    target.write_text(text[:a] + replacement + '\n\n' + text[b:], encoding='utf-8')

def main():
    loader = 'packages/insomnia/src/plugins/index.ts'
    replace(loader, "import { parsePluginPermissions }", "import { getOfflinePlugin } from '~/common/offline-plugins';\nimport { parsePluginPermissions }")
    section(loader, 'function getBundlePluginMap() {', 'export async function reloadPlugins()', '''function getBundlePluginMap() {
  const result: Record<string, Plugin> = {};
  for (const { name } of getAppBundlePlugins()) {
    const bundled = getOfflinePlugin(name);
    result[name] = {
      name,
      displayName: bundled.displayName,
      description: 'Reviewed vendored offline plugin; no installation or Internet required',
      version: bundled.version,
      directory: '',
      config: { disabled: false },
      // Trust applies ONLY to these immutable bundled sources, never arbitrary user plugins.
      permissions: { modules: [], capabilities: [] },
      permissionWarnings: [],
      permissionsDeclared: false,
      module: bundled.module,
    };
  }
  return result;
}''')
    bridge = 'packages/insomnia/src/main/templating-worker-database.ts'
    replace(bridge, "import { jarFromCookies } from '~/common/cookies';", "import { jarFromCookies } from '~/common/cookies';\nimport { getOfflinePlugin } from '~/common/offline-plugins';\nimport { openOfflineExternal } from './offline-network';")
    replace(bridge, "import { isDevelopment } from '../common/constants';\n", '')
    replace(bridge, "const bundlePluginModuleMap: Record<string, Plugin['module']> = {};\n", '')
    section(bridge, 'const getBundlePluginModule = (', '// Run a resolved plugin template tag', "const getBundlePluginModule = (pluginName: string): Plugin['module'] => getOfflinePlugin(pluginName).module;")
    replace(bridge, 'return shell.openExternal(url);', 'return openOfflineExternal(url);')
    replace(bridge, 'clipboard, dialog, shell }', 'clipboard, dialog }')
    replace('packages/insomnia/src/main/ipc/main.ts', '  shell,\n', '')
    config_path = ROOT / 'packages/insomnia/config/config.json'
    config = json.loads(config_path.read_text())
    config['bundlePlugins'] = [{'name': 'insomnia-plugin-crypto'}, {'name': 'insomnia-plugin-offline-crypto-tools'}]
    config_path.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
    package_path = ROOT / 'packages/insomnia/package.json'
    package = json.loads(package_path.read_text())
    # These unused cloud bundles must not require a private GitHub npm token.
    for name in ['@kong/insomnia-plugin-ai', '@kong/insomnia-plugin-external-vault']:
        package.get('optionalDependencies', {}).pop(name, None)
    if not package.get('optionalDependencies'):
        package.pop('optionalDependencies', None)
    package_path.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')
    (ROOT / '.npmrc').write_text('engine-strict=true\naudit=false\nfund=false\nupdate-notifier=false\n', encoding='utf-8')
    (ROOT / 'packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools/LICENSE').write_bytes((ROOT / 'LICENSE').read_bytes())
    print('Integrated checked-in plugins into both native hook and template-tag loaders; user sandbox unchanged.')

if __name__ == '__main__':
    main()
