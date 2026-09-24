import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  getHashes,
  randomBytes,
  randomUUID,
} from 'node:crypto';

import type { Plugin } from '~/common/plugins/types';
import type { NunjucksParsedTagArg, PluginTemplateTag } from '~/common/templating/types';

const hashes = ['sha256', 'sha384', 'sha512', 'sha1', 'md5', 'sm3'];
export function digest(input: string, algorithm = 'sha256') {
  if (!hashes.includes(algorithm) || !getHashes().includes(algorithm)) throw new Error('Unsupported digest algorithm');
  return createHash(algorithm).update(input, 'utf8').digest('hex');
}
export function hmac(input: string, secret: string, algorithm = 'sha256') {
  if (!['sha256', 'sha384', 'sha512', 'sha1'].includes(algorithm)) throw new Error('Unsupported HMAC algorithm');
  return createHmac(algorithm, secret).update(input, 'utf8').digest('hex');
}
function keyBytes(keyHex: string) {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error('AES-256 requires a 64-character hexadecimal key');
  return Buffer.from(keyHex, 'hex');
}
export function encryptAesGcm(input: string, keyHex: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}
export function decryptAesGcm(input: string, keyHex: string) {
  const envelope = JSON.parse(input);
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') throw new Error('Unsupported ciphertext format');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid GCM IV or authentication tag');
  const cipher = createDecipheriv('aes-256-gcm', keyBytes(keyHex), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]).toString('utf8');
}
export function signJwt(payloadJson: string, secret: string) {
  const payload: unknown = JSON.parse(payloadJson);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('JWT payload must be a JSON object');
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Use an HS256 secret of at least 32 bytes');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signed = `${header}.${body}`;
  return `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`;
}
export function decodeJwt(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Expected a three-part JWT');
  return JSON.stringify(
    {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
      signatureVerified: false,
    },
    null,
    2,
  );
}
function decodeBase32(input: string) {
  const text = input.toUpperCase().replace(/\s+/g, '').replace(/=+$/, '');
  if (!/^[A-Z2-7]+$/.test(text)) throw new Error('Invalid Base32 secret');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of text) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0 && value !== 0) throw new Error('Invalid Base32 padding');
  if (!bytes.length) throw new Error('Empty secret');
  return Buffer.from(bytes);
}
export function totp(secret: string, seconds = Math.floor(Date.now() / 1000), digits = 6, period = 30) {
  if (
    ![6, 7, 8].includes(digits) ||
    !Number.isInteger(period) ||
    period < 1 ||
    !Number.isSafeInteger(seconds) ||
    seconds < 0
  )
    throw new Error('Invalid TOTP parameters');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / period)));
  const value = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = value[value.length - 1] & 15;
  return String((value.readUInt32BE(offset) & 0x7f_ff_ff_ff) % 10 ** digits).padStart(digits, '0');
}
const text = (displayName: string, defaultValue = ''): NunjucksParsedTagArg => ({
  type: 'string',
  displayName,
  defaultValue,
});
const choice = (displayName: string, values: string[]): NunjucksParsedTagArg => ({
  type: 'enum',
  displayName,
  defaultValue: values[0],
  options: values.map(value => ({ displayName: value, value })),
});
const tag = (
  name: string,
  displayName: string,
  description: string,
  args: NunjucksParsedTagArg[],
  run: PluginTemplateTag['run'],
): PluginTemplateTag => ({ name, displayName, description, args, run });

/** Statically linked, zero dependencies, no network or filesystem access. */
export const offlineToolkit: Plugin['module'] = {
  templateTags: [
    tag(
      'offlineHash',
      'Offline Hash',
      'Native digest. MD5/SHA-1 are for legacy compatibility, not secure new designs.',
      [text('Input'), choice('Algorithm', hashes)],
      (_context, input, algorithm) => digest(input, algorithm),
    ),
    tag(
      'offlineHmac',
      'Offline HMAC',
      'Native keyed message authentication.',
      [text('Input'), text('Secret'), choice('Algorithm', ['sha256', 'sha384', 'sha512', 'sha1'])],
      (_context, input, secret, algorithm) => hmac(input, secret, algorithm),
    ),
    tag(
      'offlineAesEncrypt',
      'Offline AES-GCM Encrypt',
      'AES-256-GCM with a fresh random IV and authenticated JSON envelope.',
      [text('Plaintext'), text('Key (64 hex characters)')],
      (_context, input, key) => encryptAesGcm(input, key),
    ),
    tag(
      'offlineAesDecrypt',
      'Offline AES-GCM Decrypt',
      'Rejects modified ciphertext and incorrect keys.',
      [text('Ciphertext envelope'), text('Key (64 hex characters)')],
      (_context, input, key) => decryptAesGcm(input, key),
    ),
    tag(
      'offlineJwtSign',
      'Offline JWT HS256',
      'Sign a JSON payload locally. Supply exp/iat/aud explicitly when needed.',
      [text('Payload JSON', '{}'), text('Secret (at least 32 bytes)')],
      (_context, payload, secret) => signJwt(payload, secret),
    ),
    tag(
      'offlineJwtDecode',
      'Offline JWT Decode (unverified)',
      'Inspect header/payload only; this is NOT signature verification.',
      [text('JWT')],
      (_context, token) => decodeJwt(token),
    ),
    tag(
      'offlineTotp',
      'Offline TOTP',
      'RFC 6238 SHA-1, six digits, 30-second period. Requires an accurate local clock.',
      [text('Base32 secret')],
      (_context, secret) => totp(secret),
    ),
    tag(
      'offlineBase64',
      'Offline Base64',
      'Encode UTF-8 text or decode Base64.',
      [text('Input'), choice('Operation', ['encode', 'decode'])],
      (_context, input, operation) =>
        operation === 'decode'
          ? Buffer.from(input, 'base64').toString('utf8')
          : Buffer.from(input, 'utf8').toString('base64'),
    ),
    tag(
      'offlineUrlEncode',
      'Offline URL Component',
      'Encode/decode a single URL component.',
      [text('Input'), choice('Operation', ['encode', 'decode'])],
      (_context, input, operation) => (operation === 'decode' ? decodeURIComponent(input) : encodeURIComponent(input)),
    ),
    tag('offlineUuid', 'Offline UUID', 'Cryptographically generated UUID v4.', [], () => randomUUID()),
    tag(
      'offlineRandomHex',
      'Offline Random Hex',
      '32 cryptographically random bytes, suitable as an AES-256 key.',
      [],
      () => randomBytes(32).toString('hex'),
    ),
    tag(
      'offlineJson',
      'Offline JSON Format',
      'Validate and format JSON without external services.',
      [text('JSON', '{}')],
      (_context, input) => JSON.stringify(JSON.parse(input), null, 2),
    ),
  ],
};
