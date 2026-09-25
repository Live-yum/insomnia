// A versioned authenticated empty message verifies the existing random AES-256
// vault key locally. It contains no key or plaintext secret. The 96-bit IV is
// fresh for every proof and the 128-bit tag authenticates the salt and owner.
// Uses Web Crypto AES-GCM, not a custom cipher or a replacement secret format.
const DOMAIN = 'InsomniaOfflineVaultProof/v1';

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, byte => String.fromCodePoint(byte)).join(''));
}

function context(salt: string, owner: string): Uint8Array<ArrayBuffer> {
  if (typeof salt !== 'string' || salt.length < 16 || salt.length > 256 || typeof owner !== 'string' || owner.length > 256) {
    throw new Error('Invalid local vault context');
  }
  return new TextEncoder().encode(JSON.stringify([DOMAIN, salt, owner]));
}

async function importVaultKey(encoded: string): Promise<CryptoKey> {
  if (typeof encoded !== 'string' || encoded.length > 1024 || encoded.length === 0) {
    throw new Error('Invalid vault key');
  }
  let key: JsonWebKey;
  try {
    key = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(encoded)));
  } catch {
    throw new Error('Invalid vault key');
  }
  if (!key || key.kty !== 'oct' || key.alg !== 'A256GCM' || typeof key.k !== 'string' || !/^[\w-]{43}$/.test(key.k)) {
    throw new Error('Invalid vault key');
  }
  const raw = decodeBase64(key.k.replaceAll('-', '+').replaceAll('_', '/') + '=');
  if (raw.byteLength !== 32) {
    throw new Error('Invalid vault key');
  }
  try {
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

export async function createOfflineVaultProof(vaultKey: string, salt: string, owner: string): Promise<string> {
  const key = await importVaultKey(vaultKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const tag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: context(salt, owner), tagLength: 128 },
    key,
    new Uint8Array(0),
  );
  return JSON.stringify({ version: 1, iv: encodeBase64(iv), tag: encodeBase64(new Uint8Array(tag)) });
}

export async function verifyOfflineVaultProof(
  vaultKey: string,
  proof: string | undefined,
  salt: string,
  owner: string,
): Promise<boolean> {
  try {
    if (typeof proof !== 'string' || proof.length > 512) return false;
    const record = JSON.parse(proof);
    if (!record || record.version !== 1 || typeof record.iv !== 'string' || typeof record.tag !== 'string') return false;
    const iv = decodeBase64(record.iv);
    const tag = decodeBase64(record.tag);
    if (iv.byteLength !== 12 || tag.byteLength !== 16) return false;
    const key = await importVaultKey(vaultKey);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: context(salt, owner), tagLength: 128 }, key, tag,
    );
    return plaintext.byteLength === 0;
  } catch {
    // Untrusted key material must never be included in logs or error messages.
    return false;
  }
}
