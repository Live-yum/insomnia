// Keep native keychain semantics; never persist raw secrets or treat failed
// decryption as plaintext. In particular, Electron's Linux basic_text backend
// uses a hard-coded password and is not an acceptable secret store.
export interface NativeSecretStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

function requireProtectedBackend(storage: NativeSecretStorage, platform: NodeJS.Platform): void {
  if (!storage.isEncryptionAvailable()) {
    throw new Error('Secure OS secret storage is unavailable. Unlock your system keyring before saving or opening credentials.');
  }
  if (platform === 'linux') {
    const backend = storage.getSelectedStorageBackend();
    if (!['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend)) {
      throw new Error('A protected Linux keyring is required. Plaintext secret-storage fallback is disabled.');
    }
  }
}

export function encryptWithNativeStorage(storage: NativeSecretStorage, value: string, platform: NodeJS.Platform): string {
  requireProtectedBackend(storage, platform);
  try {
    return storage.encryptString(value).toString('hex');
  } catch {
    throw new Error('The operating system could not encrypt the credential. No plaintext value was stored.');
  }
}

export function decryptWithNativeStorage(storage: NativeSecretStorage, value: string, platform: NodeJS.Platform): string {
  requireProtectedBackend(storage, platform);
  if (typeof value !== 'string' || value.length === 0 || value.length % 2 !== 0 || /[^\da-f]/i.test(value)) {
    throw new Error('This credential is not valid OS-encrypted data. Re-enter it through the credential settings.');
  }
  try {
    return storage.decryptString(Buffer.from(value, 'hex'));
  } catch {
    throw new Error('The operating system could not decrypt the credential. Unlock its original keyring or re-enter it.');
  }
}
