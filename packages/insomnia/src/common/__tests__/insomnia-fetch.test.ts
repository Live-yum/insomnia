import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { insomniaFetch, proxyAwareFetch, setFetchImplementation } from '../insomnia-fetch';
import { OFFLINE_SERVICE_ERROR } from '../offline-policy';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('offline vendor SDK transport', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const)(
    'rejects %s before consulting either transport',
    async method => {
      const injected = vi.fn().mockResolvedValue(new Response('{}'));
      setFetchImplementation(injected);
      await expect(insomniaFetch({ method, path: '/v1/test', sessionId: 'ses_test' })).rejects.toThrow(
        OFFLINE_SERVICE_ERROR,
      );
      expect(injected).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['https://api.test', 'http://127.0.0.1:8080', 'https://example.invalid'])(
    'does not use an overridden vendor origin: %s',
    async origin => {
      const injected = vi.fn();
      const onDeepLink = vi.fn();
      setFetchImplementation(injected);
      await expect(
        insomniaFetch({ method: 'GET', path: '/v1/test', sessionId: 'ses_test', origin, retries: 3, onDeepLink }),
      ).rejects.toThrow(OFFLINE_SERVICE_ERROR);
      expect(injected).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(onDeepLink).not.toHaveBeenCalled();
    },
  );

  it('fails closed through the proxy-aware SDK entry point too', async () => {
    const injected = vi.fn();
    setFetchImplementation(injected);
    await expect(proxyAwareFetch('https://api.test/v1/test')).rejects.toThrow(OFFLINE_SERVICE_ERROR);
    expect(injected).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cannot be re-enabled by replacing the injected implementation', async () => {
    const first = vi.fn();
    const second = vi.fn();
    setFetchImplementation(first);
    setFetchImplementation(second);
    await expect(insomniaFetch({ method: 'GET', path: '/v1/test', sessionId: 'ses_test' })).rejects.toThrow(
      OFFLINE_SERVICE_ERROR,
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
