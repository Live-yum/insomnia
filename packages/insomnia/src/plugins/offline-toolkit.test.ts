import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  decodeJwt,
  decryptAesGcm,
  digest,
  encryptAesGcm,
  hmac,
  offlineToolkit,
  signJwt,
  totp,
} from './offline-toolkit';

describe('bundled offline toolkit', () => {
  it('includes twelve locally implemented template tags', () => expect(offlineToolkit.templateTags).toHaveLength(12));
  it('matches SHA-256 and HMAC vectors', () => {
    expect(digest('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hmac('The quick brown fox jumps over the lazy dog', 'key')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });
  it('uses fresh GCM IVs and rejects tampered ciphertext and wrong keys', () => {
    const key = 'ab'.repeat(32);
    const first = encryptAesGcm('内网 secret', key);
    const second = encryptAesGcm('内网 secret', key);
    expect(first).not.toBe(second);
    expect(decryptAesGcm(first, key)).toBe('内网 secret');
    expect(() => decryptAesGcm(first, 'cd'.repeat(32))).toThrow();
    const tampered = JSON.parse(first);
    tampered.tag = Buffer.alloc(16).toString('base64');
    expect(() => decryptAesGcm(JSON.stringify(tampered), key)).toThrow();
    expect(() => encryptAesGcm('data', 'bad-key')).toThrow();
  });
  it('generates a real HS256 signature and labels decoding as unverified', () => {
    const secret = 'a'.repeat(32);
    const jwt = signJwt('{"sub":"local-test"}', secret);
    const [header, payload, signature] = jwt.split('.');
    expect(signature).toBe(createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url'));
    expect(JSON.parse(decodeJwt(jwt))).toMatchObject({ payload: { sub: 'local-test' }, signatureVerified: false });
    expect(() => signJwt('{}', 'short')).toThrow();
  });
  it.each([
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ])('matches RFC 6238 at %i', (seconds, expected) => {
    expect(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', Number(seconds), 8)).toBe(expected);
  });
});
