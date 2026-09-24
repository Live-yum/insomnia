import { describe, expect, it } from 'vitest';

import { isPermissionAllowed } from './permission-policy';

describe('offline permission boundary', () => {
  it.each(['clipboard-sanitized-write', 'fileSystem'])('retains the explicit local permission %s', permission => {
    expect(isPermissionAllowed(permission)).toBe(true);
  });

  it.each(['notifications', 'geolocation', 'media', 'audioCapture', 'videoCapture', 'midi', 'midiSysex', 'clipboard-read', 'pointerLock', 'openExternal', '', 'future-unknown-permission'])('denies unlisted permission %s', permission => {
    expect(isPermissionAllowed(permission)).toBe(false);
  });

  it('does not grant case variants or prefixed permissions', () => {
    expect(isPermissionAllowed('FileSystem')).toBe(false);
    expect(isPermissionAllowed('fileSystem-read-write')).toBe(false);
  });
});
