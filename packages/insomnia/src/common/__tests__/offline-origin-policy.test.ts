import { describe, expect, it } from 'vitest';

import { isOfflineBrowserUrlAllowed, OFFLINE_APP_ORIGIN, parseOfflineOrigins } from '../offline-policy';

describe('offline browser origin validation', () => {
  it('rejects every ASCII control character, space, DEL and backslash', () => {
    const codes = [...Array.from({ length: 33 }, (_, index) => index), 127, 92];
    for (const code of codes) {
      const character = String.fromCodePoint(code);
      const origins = [
        `${character}https://api.internal`,
        `https://api${character}.internal`,
        `https://api.internal/${character}`,
      ];
      for (const origin of origins) {
        expect(() => parseOfflineOrigins(JSON.stringify([origin]))).toThrow();
      }
    }
  });

  it('accepts only exact administrator origins, including their scheme and port', () => {
    const allowed = parseOfflineOrigins('["https://api.internal:8443","wss://socket.internal"]');
    expect(isOfflineBrowserUrlAllowed('https://api.internal:8443/test', allowed)).toBe(true);
    expect(isOfflineBrowserUrlAllowed('https://api.internal/test', allowed)).toBe(false);
    expect(isOfflineBrowserUrlAllowed('http://api.internal:8443/test', allowed)).toBe(false);
    expect(isOfflineBrowserUrlAllowed('https://api.internal.evil:8443/test', allowed)).toBe(false);
  });

  it('keeps the packaged app available without permitting remote file shares', () => {
    expect(isOfflineBrowserUrlAllowed(`${OFFLINE_APP_ORIGIN}/assets/app.js`)).toBe(true);
    expect(isOfflineBrowserUrlAllowed('file://server/share/payload.js')).toBe(false);
    expect(isOfflineBrowserUrlAllowed('file:////server/share/payload.js')).toBe(false);
    expect(isOfflineBrowserUrlAllowed('https://insomnia.rest')).toBe(false);
  });
});
