import { safeStorage } from 'electron';

import { getElectronStorage } from '../electron-storage';
import { decryptWithNativeStorage, encryptWithNativeStorage } from '../secure-storage-policy';
import { ipcMainHandle } from './electron';

export interface secretStorageBridgeAPI {
  setSecret: typeof setSecret;
  getSecret: typeof getSecret;
  deleteSecret: typeof deleteSecret;
  encryptString: (raw: string) => Promise<string>;
  decryptString: (cipherText: string) => Promise<string>;
}

export function registerSecretStorageHandlers() {
  ipcMainHandle('secretStorage.setSecret', (_, key, secret) => setSecret(key, secret));
  ipcMainHandle('secretStorage.getSecret', (_, key) => getSecret(key));
  ipcMainHandle('secretStorage.deleteSecret', (_, key) => deleteSecret(key));
  ipcMainHandle('secretStorage.encryptString', (_, raw) => encryptString(raw));
  ipcMainHandle('secretStorage.decryptString', (_, raw) => decryptString(raw));
}

export const setSecret = async (key: string, secret: string) => {
  try {
    const secretStorage = getElectronStorage();
    const encrypted = encryptString(secret);
    secretStorage.setItem(key, encrypted);
  } catch (error) {
    console.error(`Can not save secret ${error.toString()}`);
    throw error;
  }
};

export const getSecret = async (key: string) => {
  try {
    const secretStorage = getElectronStorage();
    const encrypted = secretStorage.getItem(key, '');
    return encrypted === '' ? null : decryptString(encrypted);
  } catch (error) {
    console.error(`Can not get secret ${error.toString()}`);
    throw error;
  }
};

export const deleteSecret = async (key: string) => {
  try {
    const secretStorage = getElectronStorage();
    secretStorage.deleteItem(key);
  } catch (error) {
    console.error(`Can not delete secret ${error.toString()}`);
    throw error;
  }
};

// Failure is explicit: a missing/locked keyring must not silently persist raw
// credentials, and a failed decrypt must never return input as a "secret".
export const encryptString = (raw: string) => encryptWithNativeStorage(safeStorage, raw, process.platform);
export const decryptString = (cipherText: string) => decryptWithNativeStorage(safeStorage, cipherText, process.platform);
