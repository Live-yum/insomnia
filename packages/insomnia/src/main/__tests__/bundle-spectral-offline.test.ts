import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OFFLINE_BUILD } from '~/common/offline-policy';
import { bundleSpectralRuleset } from '~/main/bundle-spectral-ruleset';

vi.mock('node:fs', () => ({ default: { promises: { readFile: vi.fn() } } }));
vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('real offline ruleset policy', () => {
  it.each([
    'https://example.com/rules.yaml',
    'http://example.com/rules.yaml',
    'https://127.0.0.1/rules.yaml',
    'https://[::1]/rules.yaml',
    'https://192.168.1.10/rules.yaml',
  ])('rejects remote extends before DNS or HTTP: %s', async url => {
    expect(OFFLINE_BUILD).toBe(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(`extends: ${JSON.stringify(url)}\n`);
    await expect(bundleSpectralRuleset('/fake/rules.yaml')).rejects.toThrow('Remote ruleset loading is disabled');
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains built-in rules without downloading a remote ruleset', async () => {
    vi.mocked(fs.promises.readFile).mockResolvedValue('extends: spectral:oas\nrules: {}\n');
    expect(await bundleSpectralRuleset('/fake/rules.yaml')).toContain('spectral:oas');
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a remote dependency reached through a local child ruleset', async () => {
    vi.mocked(fs.promises.readFile).mockImplementation(async file => {
      return String(file) === path.resolve('/fake/rules.yaml')
        ? 'extends: ./child.yaml\n'
        : 'extends: https://example.com/nested.yaml\n';
    });
    await expect(bundleSpectralRuleset('/fake/rules.yaml')).rejects.toThrow('Remote ruleset loading is disabled');
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
