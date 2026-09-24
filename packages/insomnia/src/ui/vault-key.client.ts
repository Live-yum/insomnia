import type { UserSession } from 'insomnia-data';
import { services } from 'insomnia-data';

import { OFFLINE_ORGANIZATION_ID } from '~/common/offline';
import { base64encode, saveVaultKeyIfNecessary } from '~/common/utils/vault';

async function verifierFor(key: string, salt: string) {
  // Keys are randomly generated 256-bit AES keys, not low-entropy passwords.
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${key}`));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

export const saveVaultKey = async (accountId: string, vaultKey: string) => {
  const encryptedVaultKey = await window.main.secretStorage.encryptString(vaultKey);
  await services.userSession.update({ vaultKey: encryptedVaultKey });
  await saveVaultKeyIfNecessary(accountId, vaultKey);
};

export const createVaultKey = async (type: 'create' | 'reset' = 'create') => {
  try {
    const session = await services.userSession.get();
    if (type === 'create' && session.offlineVaultVerifier) return { error: 'A local vault already exists.' };
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const encoded = base64encode(JSON.stringify(await crypto.subtle.exportKey('jwk', key)));
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
    // Check OS secret storage BEFORE a user-confirmed reset modifies anything.
    const encryptedVaultKey = await window.main.secretStorage.encryptString(encoded);
    const offlineVaultVerifier = await verifierFor(encoded, salt);
    if (type === 'reset') await services.environment.removeAllSecrets([OFFLINE_ORGANIZATION_ID]);
    await services.userSession.update({ vaultSalt: salt, vaultKey: encryptedVaultKey, offlineVaultVerifier });
    await saveVaultKeyIfNecessary(session.accountId, encoded);
    return { key: encoded };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create local vault' };
  }
};

export const validateVaultKey = async (session: UserSession, vaultKey: string, vaultSalt: string) => {
  if (!session.offlineVaultVerifier || session.vaultSalt !== vaultSalt) return false;
  const actual = new TextEncoder().encode(await verifierFor(vaultKey, vaultSalt));
  const expected = new TextEncoder().encode(session.offlineVaultVerifier);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
  return difference === 0;
};
