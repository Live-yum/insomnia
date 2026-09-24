'use strict';
// Copyright 2026 Live-yum contributors. SPDX-License-Identifier: Apache-2.0
// Cryptographic primitives come exclusively from Node/OpenSSL. No network, disk,
// dynamic module loading, key storage, install scripts or background work.
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');

function base64(value, label) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(label + ' must be canonical padded Base64');
  }
  const data = Buffer.from(value, 'base64');
  if (data.toString('base64') !== value) throw new Error('Invalid ' + label);
  return data;
}
function aesGcm(operation, input, keyBase64) {
  const key = base64(keyBase64, 'AES key');
  if (key.length !== 32) throw new Error('AES-256-GCM requires a 32-byte Base64 key');
  if (typeof input !== 'string') throw new Error('Input must be a string');
  if (operation === 'encrypt') {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from('IG1'), nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
  if (operation !== 'decrypt') throw new Error('Choose encrypt or decrypt');
  const envelope = base64(input, 'Ciphertext');
  if (envelope.length < 31 || envelope.subarray(0, 3).toString() !== 'IG1') throw new Error('Invalid IG1 envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, envelope.subarray(3, 15));
  decipher.setAuthTag(envelope.subarray(15, 31));
  // Never return partial plaintext before final() authenticates the ciphertext.
  return Buffer.concat([decipher.update(envelope.subarray(31)), decipher.final()]).toString('utf8');
}
function hmac(algorithm, input, key, encoding) {
  if (!['sha256', 'sha384', 'sha512'].includes(algorithm)) throw new Error('Unsupported HMAC algorithm');
  if (!['hex', 'base64'].includes(encoding)) throw new Error('Choose hex or base64');
  if (typeof key !== 'string' || !key.length) throw new Error('HMAC key must not be empty');
  if (typeof input !== 'string') throw new Error('HMAC input must be text');
  return crypto.createHmac(algorithm, key).update(input, 'utf8').digest(encoding);
}
function rsaOaep(operation, input, pem) {
  if (typeof input !== 'string' || typeof pem !== 'string') throw new Error('Input and PEM key must be strings');
  const key = operation === 'encrypt' ? crypto.createPublicKey(pem) : crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    throw new Error('Use an RSA key of at least 2048 bits');
  }
  const options = { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };
  if (operation === 'encrypt') return crypto.publicEncrypt(options, Buffer.from(input, 'utf8')).toString('base64');
  if (operation !== 'decrypt') throw new Error('Choose encrypt or decrypt');
  return crypto.privateDecrypt(options, base64(input, 'RSA ciphertext')).toString('utf8');
}
function jwtPayload(token) {
  if (typeof token !== 'string') throw new Error('JWT must be text');
  const parts = token.split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) throw new Error('Expected a three-part JWT');
  // Decoding is NOT verification. This tag must never be used as an authentication decision.
  return JSON.stringify(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')), null, 2);
}
const text = (displayName, secret = false) => ({ displayName, type: 'string', defaultValue: '', ...(secret ? { masked: true } : {}) });
const choice = (displayName, values) => ({ displayName, type: 'enum', options: values.map(value => ({ displayName: value, value })), defaultValue: values[0] });
const operation = () => choice('Operation', ['encrypt', 'decrypt']);
module.exports.templateTags = [
  { name: 'offlineAesGcm', displayName: 'Offline AES-256-GCM', description: 'Authenticated encryption; Base64 IG1 | nonce(12) | tag(16) | ciphertext. Local only.',
    args: [operation(), text('Input'), text('32-byte key (Base64)', true)], run: (_context, ...args) => aesGcm(...args) },
  { name: 'offlineRsaOaep', displayName: 'Offline RSA-OAEP SHA-256', description: 'Small-message RSA encryption with OAEP SHA-256. PEM keys remain local.',
    args: [operation(), text('Input'), text('PEM public/private key', true)], run: (_context, ...args) => rsaOaep(...args) },
  { name: 'offlineHmac', displayName: 'Offline HMAC', description: 'Local SHA-256/384/512 message authentication code.',
    args: [choice('Algorithm', ['sha256', 'sha384', 'sha512']), text('Input'), text('Key (UTF-8)', true), choice('Encoding', ['hex', 'base64'])], run: (_context, ...args) => hmac(...args) },
  { name: 'offlineJwtPayload', displayName: 'Offline JWT payload (NOT verified)', description: 'Inspection only: decodes the payload WITHOUT verifying signature, issuer, audience or expiry.',
    args: [text('JWT')], run: (_context, token) => jwtPayload(token) },
];
