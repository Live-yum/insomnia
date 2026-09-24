import { describe, expect, it, vi } from 'vitest';

import { insomniaFetch, proxyAwareFetch, setFetchImplementation } from './insomnia-fetch';
import { isOfflineNetworkUrlAllowed, OFFLINE_BUILD, OfflineModeError } from './offline';

describe('offline network policy', () => {
  it('is an immutable offline build', () => expect(OFFLINE_BUILD).toBe(true));
  it.each(['https://insomnia-app.local/organization/org_offline/project', 'file:///app/index.html', 'http://127.0.0.1:8080', 'http://10.1.2.3', 'http://172.16.0.1', 'http://192.168.1.2', 'http://[::1]', 'http://[fd00::1]'])('allows local %s', url => expect(isOfflineNetworkUrlAllowed(url)).toBe(true));
  it.each(['https://api.insomnia.rest/v1', 'https://updates.insomnia.rest', 'https://api.segment.io', 'https://o1147619.ingest.sentry.io', 'https://renderer.gist.build', 'https://example.com', 'https://localhost.evil.example', 'http://172.32.0.1', 'javascript:alert(1)', 'not a URL'])('blocks %s', url => expect(isOfflineNetworkUrlAllowed(url)).toBe(false));
  it('requires exact administrator host entries and never allows vendor services', () => {
    expect(isOfflineNetworkUrlAllowed('https://api.corp.test', ['api.corp.test'])).toBe(true);
    expect(isOfflineNetworkUrlAllowed('https://api.corp.test.evil.test', ['api.corp.test'])).toBe(false);
    expect(isOfflineNetworkUrlAllowed('https://api.insomnia.rest', ['api.insomnia.rest'])).toBe(false);
  });
  it('never calls the cloud transport, even with injected configuration and credentials', async () => {
    const transport = vi.fn();
    setFetchImplementation(transport);
    await expect(insomniaFetch({ method: 'GET', path: '/v1/test', sessionId: 'old-cloud-session' })).rejects.toBeInstanceOf(OfflineModeError);
    await expect(proxyAwareFetch('https://api.insomnia.rest')).rejects.toBeInstanceOf(OfflineModeError);
    expect(transport).not.toHaveBeenCalled();
  });
});
