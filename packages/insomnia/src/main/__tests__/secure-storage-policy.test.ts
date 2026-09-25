import { describe, expect, it, vi } from 'vitest';

import { decryptWithNativeStorage, encryptWithNativeStorage, type NativeSecretStorage } from '../secure-storage-policy';

function native(available = true, backend = 'gnome_libsecret'): NativeSecretStorage {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    getSelectedStorageBackend: vi.fn(() => backend),
    encryptString: vi.fn(() => Buffer.from('native-ciphertext')),
    decryptString: vi.fn(() => 'opened-secret'),
  };
}

describe('protected native credential storage', () => {
  it.each(['linux', 'win32', 'darwin'] as const)('does not encrypt or return raw input without a keyring on %s', platform => {
    const storage = native(false);
    expect(() => encryptWithNativeStorage(storage, 'must-not-return', platform)).toThrow('unavailable');
    expect(() => decryptWithNativeStorage(storage, 'aa', platform)).toThrow('unavailable');
    expect(storage.encryptString).not.toHaveBeenCalled();
    expect(storage.decryptString).not.toHaveBeenCalled();
  });

  it.each(['basic_text', 'unknown', ''])('rejects Linux backend %s even when encryption reports available', backend => {
    const storage = native(true, backend);
    expect(() => encryptWithNativeStorage(storage, 'secret', 'linux')).toThrow('protected Linux keyring');
    expect(() => decryptWithNativeStorage(storage, 'aa', 'linux')).toThrow('protected Linux keyring');
    expect(storage.encryptString).not.toHaveBeenCalled();
    expect(storage.decryptString).not.toHaveBeenCalled();
  });

  it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])('uses actual native encryption for %s', backend => {
    const storage = native(true, backend);
    const cipher = encryptWithNativeStorage(storage, 'secret', 'linux');
    expect(cipher).toBe(Buffer.from('native-ciphertext').toString('hex'));
    expect(cipher).not.toBe('secret');
    expect(decryptWithNativeStorage(storage, cipher, 'linux')).toBe('opened-secret');
    expect(storage.encryptString).toHaveBeenCalledWith('secret');
    expect(storage.decryptString).toHaveBeenCalledWith(Buffer.from('native-ciphertext'));
  });

  it.each(['win32', 'darwin'] as const)('does not query a Linux-only backend on %s', platform => {
    const storage = native();
    encryptWithNativeStorage(storage, 'secret', platform);
    expect(storage.getSelectedStorageBackend).not.toHaveBeenCalled();
  });

  it.each(['', 'plaintext-password', 'abc', '01zz', 'aa\n', 'abc\n'])('rejects invalid ciphertext rather than returning it: %s', input => {
    const storage = native();
    expect(() => decryptWithNativeStorage(storage, input, 'linux')).toThrow('not valid OS-encrypted data');
    expect(storage.decryptString).not.toHaveBeenCalled();
  });

  it('sanitizes native errors and never logs or returns the secret', () => {
    const storage = native();
    vi.mocked(storage.encryptString).mockImplementation(() => { throw new Error('sensitive-input'); });
    vi.mocked(storage.decryptString).mockImplementation(() => { throw new Error('sensitive-input'); });
    expect(() => encryptWithNativeStorage(storage, 'sensitive-input', 'linux')).toThrow('No plaintext value was stored');
    expect(() => decryptWithNativeStorage(storage, 'abcd', 'linux')).toThrow('could not decrypt');
  });
});
