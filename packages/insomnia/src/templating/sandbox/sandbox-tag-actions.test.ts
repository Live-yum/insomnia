import { describe, expect, it } from 'vitest';

import type { HostBridge } from './host-bridge';
import type { ContextEnvelope, PluginExportManifest } from './marshal';
import { runTagInSandbox } from './plugin-tag-sandbox';

const source = `module.exports.templateTags = [{ name: 'token', actions: [
  { name: 'Wrong', run: function () { throw new Error('wrong action executed'); } },
  { name: 'Reset', icon: 'trash', run: async function (context) { await context.store.removeItem('token'); } }
], run: function () { throw new Error('tag run must not execute for an action'); } }];`;

const envelope = (overrides: Partial<ContextEnvelope> = {}): ContextEnvelope => ({
  args: [], context: {}, meta: {}, renderPurpose: 'preview',
  appInfo: { version: '1.0.0', platform: 'linux', arch: 'arm64' },
  pluginName: 'test-plugin', renderDepth: 0,
  grantedModules: [], grantedCapabilities: ['storage'],
  actionKind: 'templateTag', actionLabel: 'Reset', actionDomainData: { tagName: 'token' },
  ...overrides,
});

const rejectBridge: HostBridge = async path => { throw new Error(`Unexpected host call: ${path}`); };

describe('sandbox template-tag actions', () => {
  it('discovers names and icons without evaluating action bodies or exporting functions', async () => {
    const manifest = JSON.parse(await runTagInSandbox({
      pluginSource: source, tagName: '', discover: true,
      envelope: envelope({ actionKind: undefined }), bridge: rejectBridge,
    })) as PluginExportManifest;
    expect(manifest.templateTags[0].actions).toEqual([{ name: 'Wrong' }, { name: 'Reset', icon: 'trash' }]);
    expect(JSON.stringify(manifest)).not.toContain('wrong action executed');
  });

  it('invokes only the selected action through the plugin-scoped storage bridge', async () => {
    const calls: unknown[] = [];
    const bridge: HostBridge = async (path, body) => { calls.push({ path, body }); return null; };
    await runTagInSandbox({ pluginSource: source, tagName: '', envelope: envelope(), bridge });
    expect(calls).toEqual([{ path: 'pluginData.removeItem', body: { pluginName: 'test-plugin', key: 'token' } }]);
  });

  it.each([
    { actionLabel: 'missing' },
    { actionDomainData: { tagName: 'missing' } },
    { actionDomainData: undefined },
  ])('rejects a missing tag/action rather than running a different export: %j', async overrides => {
    await expect(runTagInSandbox({
      pluginSource: source, tagName: '', envelope: envelope(overrides), bridge: rejectBridge,
    })).rejects.toThrow(/Template tag action not found/);
  });

  it('does not grant network or host filesystem access to tag actions', async () => {
    await expect(runTagInSandbox({
      pluginSource: `module.exports.templateTags = [{name:'token', actions:[{name:'Reset', run:function(){require('child_process');}}]}];`,
      tagName: '', envelope: envelope(), bridge: rejectBridge,
    })).rejects.toThrow(/not permitted by manifest/);
  });

  it('bounds malicious action execution by the normal sandbox deadline', async () => {
    await expect(runTagInSandbox({
      pluginSource: `module.exports.templateTags = [{name:'token', actions:[{name:'Reset', run:function(){while(true){}}}]}];`,
      tagName: '', envelope: envelope(), bridge: rejectBridge, timeoutMs: 30,
    })).rejects.toThrow();
  });
});
