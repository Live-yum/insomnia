import * as srp from '@getinsomnia/srp-js';
import { createVault, resetVault, verifyVaultA, verifyVaultM1 } from 'insomnia-api';
import type { UserSession } from 'insomnia-data';
import { services } from 'insomnia-data';

import { OFFLINE_BUILD } from '~/common/offline';
import { createOfflineVaultProof, verifyOfflineVaultProof } from '~/common/utils/offline-vault-proof';
import { base64encode, saveVaultKeyIfNecessary } from '~/common/utils/vault';

const { Buffer, Client, generateAES256Key, getRandomHex, params, srpGenKey } = srp;

export const vaultKeyParams = params[2048];
export const saveVaultKey = async (accountId: string, vaultKey: string) => {
  // save encrypted vault key and vault salt to session
  const encryptedVaultKey = await window.main.secretStorage.encryptString(vaultKey);
  await services.userSession.update({ vaultKey: encryptedVaultKey });

  await saveVaultKeyIfNecessary(accountId, vaultKey);
};

export const createVaultKey = async (type: 'create' | 'reset' = 'create') => {
  const userSession = await services.userSession.get();
  const { accountId, id: sessionId } = userSession;

  const vaultSalt = await getRandomHex();
  const newVaultKey = await generateAES256Key();
  const base64encodedVaultKey = base64encode(JSON.stringify(newVaultKey));

  try {
    if (OFFLINE_BUILD) {
      if (type === 'create' && userSession.vaultSalt) {
        return { error: 'A local vault already exists. Unlock it or explicitly reset it.' };
      }
      const offlineVaultProof = await createOfflineVaultProof(base64encodedVaultKey, vaultSalt, accountId);
      const encryptedVaultKey = await window.main.secretStorage.encryptString(base64encodedVaultKey);
      // Persist key, salt and proof together. Never register a vendor account or verifier.
      await services.userSession.update({ vaultSalt, vaultKey: encryptedVaultKey, offlineVaultProof });
      await saveVaultKeyIfNecessary(accountId, base64encodedVaultKey);
      return { key: base64encodedVaultKey };
    }
    // Compute the verifier
    const verifier = srp
      .computeVerifier(
        vaultKeyParams,
        Buffer.from(vaultSalt, 'hex'),
        Buffer.from(accountId, 'utf8'),
        Buffer.from(base64encodedVaultKey, 'base64'),
      )
      .toString('hex');
    // send or reset saltAuth & verifier to server
    await (type === 'create'
      ? createVault({ sessionId, salt: vaultSalt, verifier })
      : resetVault({ sessionId, salt: vaultSalt, verifier }));

    // save encrypted vault key and vault salt to session
    await services.userSession.update({ vaultSalt: vaultSalt });
    await saveVaultKey(accountId, base64encodedVaultKey);
    return {
      key: base64encodedVaultKey,
    };
  } catch (error) {
    return { error: error.toString() };
  }
};

export const validateVaultKey = async (session: UserSession, vaultKey: string, vaultSalt: string) => {
  const { id: sessionId, accountId } = session;
  if (OFFLINE_BUILD) {
    const valid = await verifyOfflineVaultProof(vaultKey, session.offlineVaultProof, vaultSalt, accountId);
    // The legacy return shape is retained, but this marker is not an SRP session
    // key and is never sent to a server. Callers use it only as a validation result.
    return valid ? 'offline-local-vault-validated' : false;
  }
  const secret1 = await srpGenKey();
  const srpClient = new Client(
    vaultKeyParams,
    Buffer.from(vaultSalt, 'hex'),
    Buffer.from(accountId, 'utf8'),
    Buffer.from(vaultKey, 'base64'),
    Buffer.from(secret1, 'hex'),
  );
  try {
    // ~~~~~~~~~~~~~~~~~~~~~ //
    // Compute and Submit A  //
    // ~~~~~~~~~~~~~~~~~~~~~ //
    const srpA = srpClient.computeA().toString('hex');
    const { sessionStarterId, srpB } = await verifyVaultA({ sessionId, srpA });
    // ~~~~~~~~~~~~~~~~~~~~~ //
    // Compute and Submit M1 //
    // ~~~~~~~~~~~~~~~~~~~~~ //
    srpClient.setB(Buffer.from(srpB, 'hex'));
    const srpM1 = srpClient.computeM1().toString('hex');
    const { srpM2 } = await verifyVaultM1({ sessionId, srpM1, sessionStarterId });
    // ~~~~~~~~~~~~~~~~~~~~~~~~~ //
    // Verify Server Identity M2 //
    // ~~~~~~~~~~~~~~~~~~~~~~~~~ //
    srpClient.checkM2(Buffer.from(srpM2, 'hex'));
    const srpK = srpClient.computeK().toString('hex');
    return srpK;
  } catch (error) {
    console.error(error);
    return false;
  }
};
