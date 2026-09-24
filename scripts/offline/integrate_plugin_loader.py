#!/usr/bin/env python3
"""One-time source integration; CI commits the resulting source files to the PR.

Also stages two narrowly scoped build fixes: an obsolete shell import and exclusion
of separately reviewed third-party plugin resources from the app TypeScript project.
No third-party entrypoint is executed by this script.
"""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'packages/insomnia/src/plugins/index.ts'
MARKER = ROOT / 'docs/OFFLINE-PLUGIN-LOADER-STATUS.json'
EXPECTED = '61f357fe99df76f43dc9389816425bd8ec55f71e'


def main():
    original = TARGET.read_bytes()
    if MARKER.exists():
        record = json.loads(MARKER.read_text())
        if hashlib.sha256(original).hexdigest() != record['sha256']:
            raise ValueError('Plugin loader changed after integration; review instead of reapplying')
        return
    actual = hashlib.sha1(b'blob ' + str(len(original)).encode() + b'\0' + original).hexdigest()
    if actual != EXPECTED:
        raise ValueError('Plugin loader baseline hash mismatch')
    text = original.decode('utf-8')
    edits = [
        ("import themes from './themes';", "import { getOfflinePluginDirectories, readPluginDirectory } from './offline-catalog';\nimport themes from './themes';", 1),
        ('for (const filename of fs.readdirSync(p)) {', 'for (const filename of readPluginDirectory(p)) {', 2),
        ("const folders = (await fs.promises.readdir(p)).filter(f => f.startsWith('insomnia-plugin-'));", "const folders = readPluginDirectory(p).filter(f => f.startsWith('insomnia-plugin-'));", 1),
        ('const allPaths = [...basePaths, ...extendedPaths];', 'const allPaths = [...basePaths, ...extendedPaths, ...getOfflinePluginDirectories()];', 1),
        ("        const config = pluginJson.name in allConfigs ? allConfigs[pluginJson.name] : { disabled: false };\n", '', 1),
        ('        if ((await findDuplicatePluginNames(allPaths)).has(pluginName)) {',
         "        // Preinstalled does not mean implicitly trusted. Disabled plugins do not\n        // evaluate even top-level code, in either Node or the sandbox.\n        const config = pluginJson.name in allConfigs ? allConfigs[pluginJson.name] : { disabled: true };\n        if (!config.disabled && (await findDuplicatePluginNames(allPaths)).has(pluginName)) {", 1),
        ("        if (shouldSandboxPlugin(settings, { directory: modulePath, config })) {",
         "        if (config.disabled) {\n          module = {};\n        } else if (shouldSandboxPlugin(settings, { directory: modulePath, config })) {", 1),
        ("      openInBrowser: async (url: string) =>\n        __IS_RENDERER__ ? window.main.openInBrowser(url) : electron.shell.openExternal(url),",
         "      openInBrowser: async (_url: string): Promise<void> => {\n        throw new Error('External-browser access is disabled in the offline build.');\n      },", 1),
    ]
    for old, new, count in edits:
        if text.count(old) != count:
            raise ValueError('Plugin loader integration anchor mismatch: ' + old[:100])
        text = text.replace(old, new)
    ipc_path = ROOT / 'packages/insomnia/src/main/ipc/main.ts'
    ipc = ipc_path.read_text()
    if ipc.count('  shell,\n') != 1 or 'openOfflineExternal(href)' not in ipc:
        raise ValueError('Offline shell replacement is not present')
    ipc = ipc.replace('  shell,\n', '')
    tsconfig_path = ROOT / 'packages/insomnia/tsconfig.json'
    tsconfig = tsconfig_path.read_text()
    if tsconfig.count('    "node_modules",') != 1:
        raise ValueError('Unexpected TypeScript exclude configuration')
    tsconfig = tsconfig.replace('    "node_modules",', '    "node_modules",\n    "offline-plugin-resources",')
    TARGET.write_text(text, encoding='utf-8')
    ipc_path.write_text(ipc, encoding='utf-8')
    tsconfig_path.write_text(tsconfig, encoding='utf-8')
    MARKER.parent.mkdir(parents=True, exist_ok=True)
    MARKER.write_text(json.dumps({'baseBlob': EXPECTED, 'sha256': hashlib.sha256(text.encode()).hexdigest(),
                                 'defaultEnabled': False, 'entrypointExecutionWhileDisabled': False,
                                 'runtimeValidated': False}, indent=2) + '\n')
    # These are application files, never downloaded third-party files. Stage them
    # alongside the loader so the workflow commits all related changes together.
    subprocess.run(['git', 'add', '--', str(ipc_path.relative_to(ROOT)), str(tsconfig_path.relative_to(ROOT))], cwd=ROOT, check=True)
    print('Offline plugin loader source integration complete.')


if __name__ == '__main__':
    main()
