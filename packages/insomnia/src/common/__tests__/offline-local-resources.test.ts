import { afterEach, describe, expect, it, vi } from 'vitest';

import { OFFLINE_ORGANIZATION_ID } from '../offline';
import { isOfflineBrowserUrlAllowed, parseOfflineOrigins } from '../offline-policy';
import { fetchAndCacheOrganizationStorageRule } from '../organization-storage-rules';

afterEach(() => vi.unstubAllGlobals());

describe('offline local resource policy', () => {
  it('allows only the packaged PDF extension, without allowing its network destinations', () => {
    expect(isOfflineBrowserUrlAllowed('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html')).toBe(true);
    expect(isOfflineBrowserUrlAllowed('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/index.html')).toBe(false);
    expect(isOfflineBrowserUrlAllowed('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai.evil.test/index.html')).toBe(false);
    expect(isOfflineBrowserUrlAllowed('chrome://settings')).toBe(false);
    expect(isOfflineBrowserUrlAllowed('https://example.test/document.pdf')).toBe(false);
  });

  it('requires explicit exact-origin approval for an intranet identity provider', () => {
    const allowed = parseOfflineOrigins('["http://127.0.0.1:4010"]');
    expect(isOfflineBrowserUrlAllowed('http://127.0.0.1:4010/oidc/auth')).toBe(false);
    expect(isOfflineBrowserUrlAllowed('http://127.0.0.1:4010/oidc/auth', allowed)).toBe(true);
    expect(isOfflineBrowserUrlAllowed('http://127.0.0.1:4011/oidc/auth', allowed)).toBe(false);
    expect(isOfflineBrowserUrlAllowed('http://localhost:4010/oidc/auth', allowed)).toBe(false);
    expect(isOfflineBrowserUrlAllowed('https://127.0.0.1:4010/oidc/auth', allowed)).toBe(false);
    expect(isOfflineBrowserUrlAllowed('http://127.0.0.1.evil.test:4010/oidc/auth', allowed)).toBe(false);
  });

  it('provides local and user-managed Git storage without requesting vendor features', async () => {
    const fetch = vi.fn(() => { throw new Error('No vendor request is permitted'); });
    vi.stubGlobal('fetch', fetch);
    const rules = await fetchAndCacheOrganizationStorageRule(OFFLINE_ORGANIZATION_ID, true);
    expect(rules.enableLocalVault).toBe(true);
    expect(rules.enableGitSync).toBe(true);
    expect(rules.enableCloudSync).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'org_unknown', 'org_scratchpad'])('does not grant Git/cloud to an unrelated organization: %s', async id => {
    const rules = await fetchAndCacheOrganizationStorageRule(id);
    expect(rules.enableCloudSync).toBe(false);
    expect(rules.enableGitSync).toBe(false);
  });
});
