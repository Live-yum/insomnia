'use strict';
// SPDX-License-Identifier: Apache-2.0
// SM2 operations are provided by pinned, vendored sm-crypto-v2/noble code.
// This adapter handles formats, validation and failure semantics; no networking.
const provider = require('./sm2-provider.generated.cjs');
const { Buffer } = require('node:buffer');
const { TextDecoder } = require('node:util');
const ORDER = BigInt('0xFFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFF7203DF6B21C6052B53BBF40939D54123');
const MAX_BYTES = 1024 * 1024;
let readiness;
function fail() { throw new Error('SM2 参数、密钥或认证不正确 / Invalid SM2 parameters, key or authentication'); }
function hex(value, maximum) {
  if (typeof value !== 'string' || value.length % 2 || value.length > maximum * 2 || /[^\da-f]/i.test(value)) fail();
  return value.toLowerCase();
}
function privateKey(value) {
  const key = hex(value, 32);
  if (key.length !== 64) fail();
  const scalar = BigInt('0x' + key);
  // n-1 is unusable for the SM2 signing inverse (1+d)^-1.
  if (scalar <= 0n || scalar >= ORDER - 1n) fail();
  return key;
}
function publicKey(value) {
  const key = hex(value, 65);
  if (!((key.length === 130 && key.startsWith('04')) || (key.length === 66 && ['02', '03'].includes(key.slice(0, 2))))) fail();
  try { if (!provider.verifyPublicKey(key)) fail(); } catch { fail(); }
  return key;
}
function bytes(value, encoding = 'utf8') {
  if (typeof value !== 'string' || value.length > MAX_BYTES * 2 + 512) fail();
  if (encoding === 'hex') return Buffer.from(hex(value, MAX_BYTES + 256), 'hex');
  if (encoding === 'utf8') {
    const result = Buffer.from(value, 'utf8');
    if (result.length > MAX_BYTES || result.toString('utf8') !== value) fail();
    return result;
  }
  if (!['base64', 'base64url'].includes(encoding)) fail();
  const result = Buffer.from(value, encoding);
  if (result.length > MAX_BYTES + 256 || result.toString(encoding) !== value) fail();
  return result;
}
function output(value, encoding) {
  if (encoding === 'utf8') {
    try { return new TextDecoder('utf8', { fatal: true }).decode(value); } catch { fail(); }
  }
  if (!['hex', 'base64', 'base64url'].includes(encoding)) fail();
  return Buffer.from(value).toString(encoding);
}
function length(value) {
  if (value < 128) return Buffer.from([value]);
  let number = value.toString(16); if (number.length % 2) number = '0' + number;
  const encoded = Buffer.from(number, 'hex');
  return Buffer.concat([Buffer.from([128 + encoded.length]), encoded]);
}
function tlv(tag, value) { return Buffer.concat([Buffer.from([tag]), length(value.length), value]); }
function integer(value) {
  let number = Buffer.from(value);
  while (number.length > 1 && number[0] === 0) number = number.subarray(1);
  if (number[0] & 128) number = Buffer.concat([Buffer.from([0]), number]);
  return tlv(2, number);
}
function sequence(values) { return tlv(48, Buffer.concat(values)); }
function parseDer(value) {
  const buffer = Buffer.from(value); let cursor = 0;
  function read(expected, end) {
    if (cursor + 2 > end || buffer[cursor++] !== expected) fail();
    let size = buffer[cursor++];
    if (size & 128) {
      const count = size & 127;
      if (!count || count > 4 || cursor + count > end || !buffer[cursor]) fail();
      size = 0;
      for (let index = 0; index < count; index++) size = size * 256 + buffer[cursor++];
      if (size < 128) fail();
    }
    if (size > MAX_BYTES + 256 || cursor + size > end) fail();
    const result = buffer.subarray(cursor, cursor + size); cursor += size;
    return result;
  }
  const outer = read(48, buffer.length);
  if (cursor !== buffer.length) fail();
  const end = buffer.length;
  cursor = buffer.length - outer.length;
  return { read: tag => read(tag, end), done: () => { if (cursor !== end) fail(); } };
}
function scalarFromDer(value) {
  if (!value.length || value.length > 33 || value[0] & 128 || (value.length > 1 && value[0] === 0 && !(value[1] & 128))) fail();
  const scalar = value[0] === 0 ? value.subarray(1) : value;
  if (scalar.length > 32) fail();
  return Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]);
}
function splitCipher(data, format) {
  let c1, c2, c3;
  if (format === 'der') {
    const sequence = parseDer(data);
    const x = scalarFromDer(sequence.read(2)), y = scalarFromDer(sequence.read(2));
    c1 = Buffer.concat([Buffer.from([4]), x, y]);
    c3 = sequence.read(4); c2 = sequence.read(4); sequence.done();
  } else if (['c1c3c2', 'c1c2c3'].includes(format)) {
    if (data.length < 97 || data[0] !== 4) fail();
    c1 = data.subarray(0, 65);
    if (format === 'c1c3c2') { c3 = data.subarray(65, 97); c2 = data.subarray(97); }
    else { c2 = data.subarray(65, -32); c3 = data.subarray(-32); }
  } else { fail(); }
  if (c3.length !== 32 || c2.length > MAX_BYTES) fail();
  publicKey(c1.toString('hex'));
  return { c1, c2, c3 };
}
function joinCipher({ c1, c2, c3 }, format) {
  if (format === 'der') return sequence([integer(c1.subarray(1, 33)), integer(c1.subarray(33)), tlv(4, c3), tlv(4, c2)]);
  if (format === 'c1c3c2') return Buffer.concat([c1, c3, c2]);
  if (format === 'c1c2c3') return Buffer.concat([c1, c2, c3]);
  fail();
}
function signatureBytes(value, format) {
  let raw;
  if (format === 'der') {
    const sequence = parseDer(value);
    raw = Buffer.concat([scalarFromDer(sequence.read(2)), scalarFromDer(sequence.read(2))]); sequence.done();
  } else if (format === 'raw') raw = Buffer.from(value);
  else fail();
  if (raw.length !== 64) fail();
  for (const scalar of [raw.subarray(0, 32), raw.subarray(32)]) {
    const number = BigInt('0x' + scalar.toString('hex'));
    if (!number || number >= ORDER) fail();
  }
  return raw;
}
function signatureOutput(raw, format) {
  signatureBytes(raw, 'raw');
  if (format === 'raw') return raw;
  if (format === 'der') return sequence([integer(raw.subarray(0, 32)), integer(raw.subarray(32))]);
  fail();
}
async function executeSm2(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail();
  // Runtime CSPRNG only; reject readiness failures, never use a supplied seed or point pool.
  readiness ||= provider.initRNGPool();
  await readiness;
  const operation = options.operation;
  if (operation === 'keygen') {
    const pair = provider.generateKeyPairHex();
    privateKey(pair.privateKey); publicKey(pair.publicKey);
    return { algorithm: 'SM2', format: 'hex', publicKey: pair.publicKey, privateKey: pair.privateKey };
  }
  const format = options.cipherFormat || 'c1c3c2';
  if (operation === 'encrypt') {
    const key = publicKey(options.key);
    const input = bytes(options.input ?? '', options.inputEncoding || 'utf8');
    if (input.length === 0) throw new Error('SM2 加密请输入非空数据 / SM2 encryption requires non-empty input');
    // GM/T 0003 encryption requires retrying when the entire KDF output is zero.
    for (let attempt = 0; attempt < 16; attempt++) {
      const encrypted = Buffer.from('04' + provider.doEncrypt(input, key, 1), 'hex');
      const parts = splitCipher(encrypted, 'c1c3c2');
      if (parts.c2.equals(input)) continue;
      const encoding = options.outputEncoding || 'base64';
      return { algorithm: 'SM2', output: output(joinCipher(parts, format), encoding), encoding, cipherFormat: format, authenticated: true };
    }
    throw new Error('SM2 随机密钥派生连续失败 / SM2 random derivation failed');
  }
  if (operation === 'decrypt') {
    const key = privateKey(options.key);
    const parts = splitCipher(bytes(options.input, options.inputEncoding || 'base64'), format);
    if (!parts.c2.length) fail();
    const raw = joinCipher(parts, 'c1c3c2').subarray(1).toString('hex');
    let decoded;
    try { decoded = provider.doDecrypt(raw, key, 1, { output: 'array' }); } catch { fail(); }
    // Upstream returns [] for invalid C3; valid output is specifically Uint8Array.
    if (!(decoded instanceof Uint8Array) || decoded.length !== parts.c2.length || parts.c2.equals(Buffer.from(decoded))) fail();
    const encoding = options.outputEncoding || 'utf8';
    return { algorithm: 'SM2', output: output(decoded, encoding), encoding, authenticated: true };
  }
  if (operation !== 'sign' && operation !== 'verify') fail();
  const id = options.userId ?? '1234567812345678';
  if (typeof id !== 'string' || Buffer.byteLength(id, 'utf8') >= 8192) fail();
  bytes(id, 'utf8');
  const input = bytes(options.input ?? '', options.inputEncoding || 'utf8');
  const signatureFormat = options.signatureFormat || 'der';
  if (operation === 'sign') {
    const key = privateKey(options.key);
    const derivedPublicKey = publicKey(provider.getPublicKeyFromPrivateKey(key));
    const signature = Buffer.from(provider.doSignature(input, key, { hash: true, publicKey: derivedPublicKey, userId: id, der: false }), 'hex');
    const encoding = options.outputEncoding || 'base64';
    return { algorithm: 'SM2-SM3', output: output(signatureOutput(signature, signatureFormat), encoding), encoding, signatureFormat, userId: id };
  }
  const key = publicKey(options.key);
  let signature;
  try { signature = signatureBytes(bytes(options.signature, options.signatureEncoding || 'base64'), signatureFormat); } catch { return { algorithm: 'SM2-SM3', valid: false }; }
  let valid;
  try { valid = provider.doVerifySignature(input, signature.toString('hex'), key, { hash: true, userId: id, der: false }); } catch { valid = false; }
  return { algorithm: 'SM2-SM3', valid: valid === true, userId: id };
}
module.exports = { executeSm2 };
