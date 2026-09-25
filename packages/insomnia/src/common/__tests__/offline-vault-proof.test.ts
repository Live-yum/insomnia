import { describe, expect, it, vi } from 'vitest';

import { createOfflineVaultProof, verifyOfflineVaultProof } from '../utils/offline-vault-proof';

const salt = 'a8e0bb5dd096876a6bd9fd9c216558abb728cb79d2f1d357f4a817617b139d51';
const owner = '';

async function generateKey() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return btoa(JSON.stringify(await crypto.subtle.exportKey('jwk', key)));
}

describe('offline vault key proof', () => {
  it('authenticates the random vault key with no remote service', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
    try {
      const key = await generateKey();
      const proof = await createOfflineVaultProof(key, salt, owner);
      expect(await verifyOfflineVaultProof(key, proof, salt, owner)).toBe(true);
      expect(proof).not.toContain(key);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('uses fresh IVs even for the same key and context', async () => {
    const key = await generateKey();
    const first = await createOfflineVaultProof(key, salt, owner);
    const second = await createOfflineVaultProof(key, salt, owner);
    expect(first).not.toBe(second);
    expect(await verifyOfflineVaultProof(key, first, salt, owner)).toBe(true);
    expect(await verifyOfflineVaultProof(key, second, salt, owner)).toBe(true);
  });

  it('rejects another key and a changed salt or owner', async () => {
    const key = await generateKey();
    const proof = await createOfflineVaultProof(key, salt, owner);
    expect(await verifyOfflineVaultProof(await generateKey(), proof, salt, owner)).toBe(false);
    expect(await verifyOfflineVaultProof(key, proof, '0'.repeat(64), owner)).toBe(false);
    expect(await verifyOfflineVaultProof(key, proof, salt, 'another-owner')).toBe(false);
  });

  it.each(['iv', 'tag'])('rejects tampering with %s', async field => {
    const key = await generateKey();
    const record = JSON.parse(await createOfflineVaultProof(key, salt, owner));
    const bytes = atob(record[field]);
    record[field] = btoa(String.fromCodePoint((bytes.codePointAt(0) ?? 0) ^ 1) + bytes.slice(1));
    expect(await verifyOfflineVaultProof(key, JSON.stringify(record), salt, owner)).toBe(false);
  });

  it.each([undefined, '', '{}', 'null', '{"version":2}', 'x'.repeat(513)])('rejects missing or invalid proof %s', async proof => {
    expect(await verifyOfflineVaultProof(await generateKey(), proof, salt, owner)).toBe(false);
  });

  it.each(['', 'not-a-key', btoa('{}'), btoa('null'), 'x'.repeat(1025)])('rejects invalid key material without logging it', async key => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const valid = await generateKey();
      const proof = await createOfflineVaultProof(valid, salt, owner);
      expect(await verifyOfflineVaultProof(key, proof, salt, owner)).toBe(false);
      await expect(createOfflineVaultProof(key, salt, owner)).rejects.toThrow('Invalid vault key');
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
