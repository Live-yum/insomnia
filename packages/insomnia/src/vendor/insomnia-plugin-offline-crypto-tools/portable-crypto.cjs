'use strict';
// SPDX-License-Identifier: Apache-2.0
// Strict adapters around fixed, bundled primitives. Never access files/network or persist keys.
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const primitives = require('./primitives.generated.cjs');
const ORDER = BigInt('0xfffffffeffffffffffffffffffffffff7203df6b21c6052b53bbf40939d54123');
const error = () => { throw new Error('国密参数、密钥或完整性校验失败 / Invalid SM parameters, key or integrity'); };
const supportsHash = name => name === 'sm3' || Object.hasOwn(primitives.sha3, name);
function digest(name, bytes) {
  if (name === 'sm3') return Buffer.from(primitives.sm3(Uint8Array.from(bytes)), 'hex');
  if (!Object.hasOwn(primitives.sha3, name)) return error();
  return Buffer.from(primitives.sha3[name](Uint8Array.from(bytes)));
}
function mac(name, key, bytes) {
  if (name === 'sm3') return Buffer.from(primitives.sm3(Uint8Array.from(bytes), { key: Uint8Array.from(key) }), 'hex');
  if (!Object.hasOwn(primitives.sha3, name)) return error();
  return Buffer.from(primitives.hmac(primitives.sha3[name], Uint8Array.from(key), Uint8Array.from(bytes)));
}
function sm4Cipher({ key, iv, input, encrypting, mode, padding = 'pkcs7' }) {
  if (key.length !== 16 || iv.length !== 16 || !['cbc', 'ctr'].includes(mode)) return error();
  if (mode === 'ctr') {
    const blocks = Math.ceil(input.length / 16);
    const counters = Buffer.alloc(blocks * 16);
    const counter = Buffer.from(iv);
    for (let block = 0; block < blocks; block++) {
      counter.copy(counters, block * 16);
      if (block + 1 < blocks) {
        let i = 15;
        for (; i >= 0; i--) { counter[i] = (counter[i] + 1) & 255; if (counter[i]) break; }
        if (i < 0) return error(); // never reuse a wrapped counter within a message
      }
    }
    // ECB is only an internal block primitive for CTR, not an exposed encryption mode.
    const stream = primitives.sm4.encrypt(Uint8Array.from(counters), Uint8Array.from(key), { padding: 'none', output: 'array' });
    const output = Buffer.alloc(input.length);
    for (let i = 0; i < input.length; i++) output[i] = input[i] ^ stream[i];
    counters.fill(0); counter.fill(0); stream.fill(0);
    return output;
  }
  if (!['pkcs7', 'none'].includes(padding)) return error();
  let data = Buffer.from(input);
  if (encrypting && padding === 'pkcs7') {
    const count = 16 - data.length % 16;
    data = Buffer.concat([data, Buffer.alloc(count, count)]);
  }
  if (data.length % 16 || (!encrypting && padding === 'pkcs7' && !data.length)) return error();
  const raw = Buffer.from(primitives.sm4[encrypting ? 'encrypt' : 'decrypt'](Uint8Array.from(data), Uint8Array.from(key), {
    mode: 'cbc', iv: Uint8Array.from(iv), padding: 'none', output: 'array',
  }));
  if (!encrypting && padding === 'pkcs7') {
    const count = raw[raw.length - 1];
    let invalid = Number(count < 1 || count > 16);
    for (let i = 1; i <= 16; i++) invalid |= Number(i <= count) * (raw[raw.length - i] ^ count);
    if (invalid) { raw.fill(0); return error(); }
    return raw.subarray(0, raw.length - count);
  }
  return raw;
}
function scalar(value) {
  if (typeof value !== 'string' || !/^[\da-f]{64}$/i.test(value)) return error();
  const number = BigInt('0x' + value);
  // d=n-1 cannot be used by SM2 signing, which requires inverse(1+d).
  if (number <= 0n || number >= ORDER - 1n) return error();
  return value.toLowerCase();
}
function publicKey(value) {
  if (typeof value !== 'string' || !/^(04[\da-f]{128}|0[23][\da-f]{64})$/i.test(value)) return error();
  try { if (!primitives.sm2.verifyPublicKey(value)) return error(); } catch { return error(); }
  return value.toLowerCase();
}
function generateSm2() {
  for (let attempt = 0; attempt < 128; attempt++) {
    const key = crypto.randomBytes(32);
    const n = BigInt('0x' + key.toString('hex'));
    if (n > 0n && n < ORDER - 1n) {
      const privateKey = key.toString('hex'); key.fill(0);
      return { algorithm: 'sm2', format: 'hex', privateKey, publicKey: primitives.sm2.getPublicKeyFromPrivateKey(privateKey) };
    }
    key.fill(0);
  }
  return error();
}
function signatureToRaw(bytes, format) {
  if (format === 'raw') {
    if (bytes.length !== 64) return error();
    return Buffer.from(bytes);
  }
  if (format !== 'der' || bytes.length < 8 || bytes.length > 72 || bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2) return error();
  let at = 2;
  const parts = [];
  for (let index = 0; index < 2; index++) {
    if (bytes[at++] !== 2) return error();
    const len = bytes[at++];
    if (len < 1 || len > 33 || at + len > bytes.length) return error();
    let part = bytes.subarray(at, at + len); at += len;
    if (part[0] & 128 || (len > 1 && part[0] === 0 && !(part[1] & 128))) return error();
    if (part[0] === 0) part = part.subarray(1);
    if (part.length > 32) return error();
    parts.push(Buffer.concat([Buffer.alloc(32 - part.length), part]));
  }
  if (at !== bytes.length) return error();
  return Buffer.concat(parts);
}
function sm2Operation(options, decode, encode) {
  const operation = options.operation;
  if (operation === 'keygen') return generateSm2();
  if (!['encrypt', 'decrypt', 'sign', 'verify'].includes(operation)) return error();
  const input = decode(options.input ?? '', options.inputEncoding || (operation === 'decrypt' ? 'base64' : 'utf8'));
  // Keep expensive asymmetric operations bounded independently of the general text limit.
  if (input.length > 1024 * 1024) return error();
  if (operation === 'sign' || operation === 'verify') {
    const userId = options.userId ?? '1234567812345678';
    const userBytes = decode(userId, 'utf8');
    if (userBytes.length > 8191) return error();
    const format = options.signatureFormat || 'der';
    if (!['der', 'raw'].includes(format)) return error();
    if (operation === 'sign') {
      const key = scalar(options.key);
      const signature = primitives.sm2.doSignature(Uint8Array.from(input), key, { hash: true, der: format === 'der', userId });
      const encoding = options.outputEncoding || 'base64';
      return { algorithm: 'SM2-SM3', signatureFormat: format, output: encode(Buffer.from(signature, 'hex'), encoding), encoding, userId };
    }
    const key = publicKey(options.key);
    const signature = decode(options.signature, options.signatureEncoding || 'base64');
    let valid = false;
    try {
      const raw = signatureToRaw(signature, format);
      const r = BigInt('0x' + raw.subarray(0, 32).toString('hex'));
      const s = BigInt('0x' + raw.subarray(32).toString('hex'));
      valid = r > 0n && r < ORDER && s > 0n && s < ORDER && primitives.sm2.doVerifySignature(Uint8Array.from(input), raw.toString('hex'), key, { hash: true, userId });
    } catch { valid = false; }
    return { algorithm: 'SM2-SM3', valid, userId };
  }
  const layout = options.cipherMode || 'c1c3c2';
  if (!['c1c3c2', 'c1c2c3'].includes(layout)) return error();
  const mode = layout === 'c1c3c2' ? 1 : 0;
  const encoding = options.outputEncoding || (operation === 'encrypt' ? 'base64' : 'utf8');
  if (operation === 'encrypt') {
    const key = publicKey(options.key);
    // The SM2 KDF zero-stream rule is undefined for an empty message; reject it explicitly.
    if (!input.length) throw new Error('SM2 加密要求非空输入 / SM2 encryption requires a nonempty message');
    for (let attempt = 0; attempt < 128; attempt++) {
      const raw = Buffer.from('04' + primitives.sm2.doEncrypt(Uint8Array.from(input), key, mode), 'hex');
      if (raw.length !== input.length + 97) return error();
      const c2 = mode === 1 ? raw.subarray(97) : raw.subarray(65, raw.length - 32);
      // GM/T0003: retry a fresh ephemeral key when KDF returns all-zero bytes.
      if (crypto.timingSafeEqual(c2, input)) continue;
      return { algorithm: 'SM2', cipherMode: layout, pointPrefix: '04', output: encode(raw, encoding), encoding };
    }
    return error();
  }
  const key = scalar(options.key);
  if (input.length < 98 || input[0] !== 4) return error();
  publicKey(input.subarray(0, 65).toString('hex'));
  let plain;
  try { plain = primitives.sm2.doDecrypt(input.subarray(1).toString('hex'), key, mode, { output: 'array' }); } catch { return error(); }
  // Upstream returns a plain [] on C3 mismatch, never a successful Uint8Array.
  // Do not mistake it for a valid empty plaintext or return partially decrypted data.
  if (!(plain instanceof Uint8Array) || plain.length !== input.length - 97) return error();
  const c2 = mode === 1 ? input.subarray(97) : input.subarray(65, input.length - 32);
  if (crypto.timingSafeEqual(c2, plain)) { plain.fill(0); return error(); }
  const output = encode(plain, encoding); plain.fill(0);
  return { algorithm: 'SM2', cipherMode: layout, output, encoding, integrityVerified: true };
}
module.exports = { supportsHash, digest, mac, sm4Cipher, sm2Operation, generateSm2 };
