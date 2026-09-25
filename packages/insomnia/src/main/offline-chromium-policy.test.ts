import { describe, expect, it, vi } from 'vitest';

import { configureOfflineChromium, OFFLINE_CHROMIUM_SWITCHES } from './offline-chromium-policy';

describe('offline Chromium background policy', () => {
  it('explicitly disables component updates and background reporting', () => {
    const appendSwitch = vi.fn();
    configureOfflineChromium({ appendSwitch });
    expect(appendSwitch.mock.calls).toEqual([
      ['disable-background-networking'],
      ['disable-component-update'],
      ['disable-domain-reliability'],
      ['no-pings'],
    ]);
  });

  it('does not disable isolation, the sandbox, TLS or certificate verification', () => {
    expect(OFFLINE_CHROMIUM_SWITCHES).not.toContain('no-sandbox');
    expect(OFFLINE_CHROMIUM_SWITCHES).not.toContain('disable-setuid-sandbox');
    expect(OFFLINE_CHROMIUM_SWITCHES).not.toContain('disable-web-security');
    expect(OFFLINE_CHROMIUM_SWITCHES).not.toContain('ignore-certificate-errors');
  });
});
