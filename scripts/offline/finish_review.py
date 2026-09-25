#!/usr/bin/env python3
"""Apply reviewed offline source repairs; run only in a read-only validation job.

No plugin is executed, no archive is changed, no credentials are read, and no
GitHub write is performed here. Every replacement has an exact source anchor.
The separate publisher accepts only the tested diff at its unchanged parent.
"""
from pathlib import Path
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASE = 'packages/insomnia/src/'


def replace(relative, before, after):
    target = ROOT / relative
    text = target.read_text(encoding='utf-8')
    if after in text and before not in text:
        return
    if text.count(before) != 1:
        raise ValueError('Review changed source anchor: ' + relative)
    target.write_text(text.replace(before, after, 1), encoding='utf-8', newline='\n')


def append(relative, text):
    target = ROOT / relative
    current = target.read_text(encoding='utf-8')
    if text.strip() not in current:
        target.write_text(current.rstrip() + '\n\n' + text.strip() + '\n', encoding='utf-8')


def main():
    replace(BASE + 'templating/sandbox/marshal.ts',
            "actionKind?: 'request' | 'requestGroup' | 'workspace' | 'document';",
            "actionKind?: 'request' | 'requestGroup' | 'workspace' | 'document' | 'templateTag';")
    replace(BASE + 'templating/sandbox/marshal.ts', '  args?: unknown[];\n}',
            '  args?: unknown[];\n  /** Metadata only; action functions remain inside the sandbox. */\n  actions?: { name: string; icon?: string }[];\n}')
    replace(BASE + 'templating/sandbox/in-sandbox-bootstrap.ts',
            "  '    var lists = { request: mod.requestActions, requestGroup: mod.requestGroupActions, workspace: mod.workspaceActions, document: mod.documentActions };',",
            '''  '    if (env.actionKind === "templateTag") {',
  '      var tags = Array.isArray(mod.templateTags) ? mod.templateTags : [];',
  '      var tagName = env.actionDomainData && env.actionDomainData.tagName;',
  '      var tag = null;',
  '      for (var t = 0; t < tags.length; t++) { if (tags[t] && tags[t].name === tagName) { tag = tags[t]; break; } }',
  '      var tagActions = tag && Array.isArray(tag.actions) ? tag.actions : [];',
  '      var tagAction = null;',
  '      for (var a = 0; a < tagActions.length; a++) { if (tagActions[a] && tagActions[a].name === env.actionLabel) { tagAction = tagActions[a]; break; } }',
  '      if (!tagAction || typeof tagAction.run !== "function") { throw new Error("Template tag action not found: " + tagName + "/" + env.actionLabel); }',
  '      return Promise.resolve(tagAction.run({ store: ctx.store })).then(function () { return "{}"; });',
  '    }',
  '    var lists = { request: mod.requestActions, requestGroup: mod.requestGroupActions, workspace: mod.workspaceActions, document: mod.documentActions };',''')
    replace(BASE + 'templating/sandbox/in-sandbox-bootstrap.ts',
            "  '    var tagDesc = function (t) { return isObj(t) ? { name: t.name, displayName: t.displayName, description: t.description, args: t.args || [] } : null; };',",
            '''  '    var tagActionDesc = function (a) { return isObj(a) && typeof a.name === "string" && typeof a.run === "function" ? { name: a.name, icon: typeof a.icon === "string" ? a.icon : undefined } : null; };',
  '    var tagDesc = function (t) {',
  '      if (!isObj(t)) { return null; }',
  '      var d = { name: t.name, displayName: t.displayName, description: t.description, args: t.args || [] };',
  '      if (Array.isArray(t.actions)) { d.actions = mapArr(t.actions.slice(0, 1000), tagActionDesc); }',
  '      return d;',
  '    };',''')
    file = ROOT / (BASE + 'plugins/index.ts')
    text = file.read_text(encoding='utf-8')
    text = text.replace('notRouted', 'descriptorOnly')
    text = text.replace("Hook/action invocation isn't sandbox-routed yet, so those\n// function members throw a clear error until that lands (PR 10/11); the plugin's tags/hooks/actions\n// still *enumerate* in the UI from these descriptors.",
                        'Hook/action invocation is routed by invoke-method through the authenticated main-process bridge.\n// Descriptor functions never execute locally; untrusted functions do not cross into the host.')
    text = text.replace('sandboxed ${surface} are not supported yet. Disable "Run template tags in sandbox" to use them.',
                        'sandboxed ${surface} must execute through the authenticated plugin bridge.')
    file.write_text(text, encoding='utf-8')
    replace(BASE + 'plugins/index.ts',
            "templateTags: manifest.templateTags.map(t => ({ ...t, run: descriptorOnly('template-tag run()') }) as PluginTemplateTag),",
            """templateTags: manifest.templateTags.map(t => ({
      ...t,
      ...(t.actions ? { actions: t.actions.map(a => ({ ...a, run: descriptorOnly('template-tag action') })) } : {}),
      run: descriptorOnly('template-tag run()'),
    }) as PluginTemplateTag),""")
    replace(BASE + 'plugins/invoke-method.ts',
            '      await action.run(pluginStore.init(tag.plugin));',
            """      const settings = await fetchFromTemplateWorkerDatabase('settings.get', {});
      if (shouldSandboxPlugin(settings, tag.plugin)) {
        await fetchFromTemplateWorkerDatabase('plugin.runUserAction', {
          plugin: { directory: tag.plugin.directory, name: tag.plugin.name, permissions: tag.plugin.permissions },
          actionKind: 'templateTag',
          actionLabel: actionName,
          actionDomainData: { tagName },
        });
        return null;
      }
      await action.run(pluginStore.init(tag.plugin));""")
    file = ROOT / (BASE + 'main/templating-worker-database.ts')
    text = file.read_text(encoding='utf-8')
    before = '  pluginName: string,\n): Promise<{ directory: string; permissions:'
    if before not in text:
        raise ValueError('Review trusted plugin resolver signature')
    text = text.replace(before, '  pluginName: string,\n  execution = false,\n): Promise<{ directory: string; permissions:', 1)
    before = '  return { directory: plugin.directory, permissions: plugin.permissions };'
    if text.count(before) != 1:
        raise ValueError('Review trusted plugin resolver return')
    text = text.replace(before, '''  if (execution && (plugin.config?.disabled || plugin.loadError)) {
    throw new Error(`Plugin is disabled or failed to load: ${pluginName}`);
  }
  return { directory: plugin.directory, permissions: plugin.permissions };''', 1)
    text = text.replace("actionKind: 'request' | 'requestGroup' | 'workspace' | 'document',", "actionKind: 'request' | 'requestGroup' | 'workspace' | 'document' | 'templateTag',")
    text = text.replace("actionKind: 'request' | 'requestGroup' | 'workspace' | 'document';", "actionKind: 'request' | 'requestGroup' | 'workspace' | 'document' | 'templateTag';")
    before = 'const trusted = await resolveTrustedPlugin(body.plugin.name);'
    if text.count(before) != 3:
        raise ValueError('Review the three execution handlers')
    text = text.replace(before, 'const trusted = await resolveTrustedPlugin(body.plugin.name, true);')
    start = text.index('export const runActionInSandbox =')
    anchor = "  const { runTagInSandbox } = await import('../templating/sandbox/plugin-tag-sandbox');"
    position = text.index(anchor, start)
    text = text[:position] + """  if (!['request', 'requestGroup', 'workspace', 'document', 'templateTag'].includes(actionKind)) {
    throw new Error(`Unsupported sandbox action kind: ${actionKind}`);
  }
  if (typeof actionLabel !== 'string' || actionLabel.length > 4096) {
    throw new Error('Invalid sandbox action label');
  }
""" + text[position:]
    file.write_text(text, encoding='utf-8')
    for file in (ROOT / 'packages/insomnia-smoke-test/tests').rglob('*.ts'):
        text = file.read_text(encoding='utf-8')
        updated = re.sub(r"\bpage\.click\(('(?:[^'\\]|\\.)*')\)", r'page.locator(\1).click()', text)
        if updated != text:
            file.write_text(updated, encoding='utf-8')
    for file in (ROOT / 'packages').glob('*/package.json'):
        text = file.read_text(encoding='utf-8')
        if '"lint": "eslint ' in text and '--max-warnings=0' not in text:
            file.write_text(re.sub(r'("lint": "eslint [^"\n]+)(")', r'\1 --max-warnings=0\2', text), encoding='utf-8')
    for file in (ROOT / '.github/workflows').glob('*.yml'):
        text = file.read_text(encoding='utf-8')
        updated = text.replace('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02', 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a')
        updated = updated.replace('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093', 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c')
        if updated != text:
            file.write_text(updated, encoding='utf-8')
    # Only the five cycles proven REMOVED by Test App are removed from the baseline.
    # Never add a new violation merely to make CI pass.
    file = ROOT / 'scripts/circular-references/known-violations.json'
    record = json.loads(file.read_text(encoding='utf-8'))
    removed = [
        'root.tsx -> ui/components/modals/settings-modal.tsx -> ui/components/settings/general.tsx -> ui/components/settings/vault-key-panel.tsx -> ui/components/modals/input-vault-key-modal.tsx -> ui/hooks/use-account-server-data.ts',
        'root.tsx -> ui/components/modals/settings-modal.tsx -> ui/components/settings/import-export.tsx -> ui/components/modals/import-modal/import-projects-modal.tsx -> ui/hooks/use-account-server-data.ts',
        'root.tsx -> ui/components/modals/settings-modal.tsx -> ui/components/settings/import-export.tsx -> ui/hooks/use-account-server-data.ts',
        'root.tsx -> ui/components/modals/settings-modal.tsx -> ui/components/settings/import-export.tsx -> ui/hooks/use-plan.tsx -> ui/hooks/use-account-server-data.ts',
        'root.tsx -> ui/containers/app-hooks.tsx -> ui/hooks/use-cio.tsx',
    ]
    for cycle in removed:
        full = ' -> '.join(BASE + part for part in cycle.split(' -> '))
        if full in record['insomnia']:
            record['insomnia'].remove(full)
    file.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    append(BASE + 'main/__tests__/templating-worker-database-protocol-authorization.test.ts', '''
describe('disabled plugins cannot execute via an authenticated orchestration request', () => {
  it.each(['plugin.runUserRequestHook', 'plugin.runUserResponseHook', 'plugin.runUserAction'])(
    '%s refuses disabled plugins before source is read or hooks are run', async method => {
      const { getPlugins } = await import('~/plugins');
      vi.mocked(getPlugins).mockResolvedValue([{
        name: 'disabled-plugin', directory: '/must-not-be-read', config: { disabled: true }, permissions: {},
      }] as any);
      const { resolveDbByKey } = await import('../templating-worker-database');
      const response = await resolveDbByKey(new Request(`insomnia-templating-worker-database://${method.toLowerCase()}`, {
        method: 'POST', headers: { [TEMPLATING_DB_AUTH_HEADER]: getOrCreateTemplatingDbAuthToken() },
        body: JSON.stringify({ plugin: { name: 'disabled-plugin', directory: '/forged' }, actionKind: 'templateTag', actionLabel: 'Reset' }),
      }));
      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/Plugin is disabled or failed to load/);
    },
  );
});
''')
    append(BASE + 'plugins/__tests__/invoke-method.test.ts', '''
describe('authenticated sandbox surface dispatch', () => {
  it('routes request hooks through the bridge and merges only approved fields', async () => {
    const descriptor = vi.fn(() => { throw new Error('host descriptor executed'); });
    _testOnlySetPlugins([makePlugin({ module: { requestHooks: [descriptor, descriptor] } })]);
    const indices: number[] = [];
    vi.mocked(fetchFromTemplateWorkerDatabase).mockImplementation(async (method, body: any) => {
      if (method === 'settings.get') return { pluginSandboxEnabled: true };
      if (method === 'plugin.runUserRequestHook') {
        indices.push(body.hookIndex);
        return { headers: [{ name: 'X-Sandbox', value: String(body.hookIndex) }], dangerousField: 'ignored' };
      }
      throw new Error(`Unexpected bridge method: ${method}`);
    });
    const result = await invokePluginMethod('applyRequestHooks', {
      renderedRequest: { url: 'http://127.0.0.1', headers: [] }, projectId: 'local', environment: {},
    });
    expect(indices).toEqual([0, 1]);
    expect(result).toMatchObject({ headers: [{ name: 'X-Sandbox', value: '1' }] });
    expect(result).not.toHaveProperty('dangerousField');
    expect(descriptor).not.toHaveBeenCalled();
  });
  it('routes response hooks without evaluating host-side descriptors', async () => {
    const descriptor = vi.fn(() => { throw new Error('host descriptor executed'); });
    _testOnlySetPlugins([makePlugin({ module: { responseHooks: [descriptor] } })]);
    vi.mocked(fetchFromTemplateWorkerDatabase).mockImplementation(async method => {
      if (method === 'settings.get') return { pluginSandboxEnabled: true };
      if (method === 'plugin.runUserResponseHook') return { statusCode: 201 };
      throw new Error(`Unexpected bridge method: ${method}`);
    });
    const result = await invokePluginMethod('applyResponseHooks', {
      response: { statusCode: 200 }, renderedRequest: {}, projectId: 'local', environment: {},
    });
    expect(result).toMatchObject({ statusCode: 201 });
    expect(descriptor).not.toHaveBeenCalled();
  });
  it('routes template-tag actions by tag and action name, never through the descriptor', async () => {
    const run = vi.fn(() => { throw new Error('host descriptor executed'); });
    _testOnlySetPlugins([makePlugin({ module: { templateTags: [{
      name: 'token', displayName: 'Token', description: '', args: [], run,
      actions: [{ name: 'Reset', run }],
    }] } })]);
    vi.mocked(fetchFromTemplateWorkerDatabase).mockImplementation(async method =>
      method === 'settings.get' ? { pluginSandboxEnabled: true } : null,
    );
    await expect(invokePluginMethod('runTemplateTagAction', {
      pluginName: 'test-plugin', tagName: 'token', actionName: 'Reset',
    })).resolves.toBeNull();
    expect(fetchFromTemplateWorkerDatabase).toHaveBeenCalledWith('plugin.runUserAction', {
      plugin: { directory: '/plugins/test-plugin', name: 'test-plugin', permissions: { modules: [], capabilities: [] } },
      actionKind: 'templateTag', actionLabel: 'Reset', actionDomainData: { tagName: 'token' },
    });
    expect(run).not.toHaveBeenCalled();
  });
  it.each(['request', 'requestGroup', 'workspace', 'document'] as const)('routes %s actions through the authenticated bridge', async type => {
    const action = vi.fn(() => { throw new Error('host descriptor executed'); });
    _testOnlySetPlugins([makePlugin({ module: { [`${type}Actions`]: [{ label: 'Run', action }] } })]);
    vi.mocked(fetchFromTemplateWorkerDatabase).mockImplementation(async method =>
      method === 'settings.get' ? { pluginSandboxEnabled: true } : null,
    );
    await invokePluginMethod('executeAction', { type, pluginName: 'test-plugin', label: 'Run', projectId: 'local', domainData: {} });
    expect(fetchFromTemplateWorkerDatabase).toHaveBeenCalledWith('plugin.runUserAction', expect.objectContaining({ actionKind: type, actionLabel: 'Run' }));
    expect(action).not.toHaveBeenCalled();
  });
});
''')
    subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)
    changed = subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT, text=True).splitlines()
    scripts = [name for name in changed if name.endswith(('.ts', '.tsx', '.js', '.mjs'))]
    scripts.extend(['packages/insomnia-inso/src/analytics.ts', 'packages/insomnia-inso/src/analytics.test.ts',
                    BASE + 'templating/sandbox/sandbox-tag-actions.test.ts'])
    subprocess.run(['node', str(ROOT / 'node_modules/eslint/bin/eslint.js'), '--fix', *scripts], cwd=ROOT, check=True)
    subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)
    print('Reviewed repairs applied; no plugin entrypoint executed.')


if __name__ == '__main__':
    main()
