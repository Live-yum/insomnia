'use strict';
// Independently verify the adapter using system OpenSSL, not a second wrapper call.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { executeSm2 } = require('../../packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools/sm2.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnia-sm2-'));
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const file = name => path.join(directory, name);
const openssl = (...args) => execFileSync('openssl', args, { cwd: directory, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
console.log('Independent interoperability provider:', openssl('version').trim());
openssl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:SM2', '-out', file('key.pem'));
openssl('pkey', '-in', file('key.pem'), '-pubout', '-out', file('public.pem'));
const nativeText = openssl('pkey', '-in', file('key.pem'), '-text', '-noout');
const privateKey = nativeText.match(/priv:\s*([\da-f:\s]+)pub:/i)?.[1].replace(/\s|:/g, '').padStart(64, '0');
const publicKey = nativeText.match(/pub:\s*([\da-f:\s]+)ASN1 OID:/i)?.[1].replace(/\s|:/g, '');
assert.equal(privateKey?.length, 64); assert.equal(publicKey?.length, 130);
const plaintext = 'SM2 互通加解密 test 🔒';
fs.writeFileSync(file('input'), plaintext);

test('OpenSSL encrypt -> checked SM2 decrypt in DER format', async () => {
  openssl('pkeyutl', '-encrypt', '-pubin', '-inkey', file('public.pem'), '-in', file('input'), '-out', file('cipher'));
  const ciphertext = fs.readFileSync(file('cipher')).toString('base64');
  assert.equal((await executeSm2({ operation: 'decrypt', key: privateKey, cipherFormat: 'der', input: ciphertext })).output, plaintext);
});
test('checked SM2 encrypt -> OpenSSL decrypt in DER format', async () => {
  const encrypted = await executeSm2({ operation: 'encrypt', key: publicKey, cipherFormat: 'der', input: plaintext });
  fs.writeFileSync(file('cipher-ours'), Buffer.from(encrypted.output, 'base64'));
  assert.equal(openssl('pkeyutl', '-decrypt', '-inkey', file('key.pem'), '-in', file('cipher-ours')), plaintext);
});
for (const format of ['c1c3c2', 'c1c2c3', 'der']) {
  test(`SM2 ${format} roundtrip and C3 tampering rejection`, async () => {
    const encrypted = await executeSm2({ operation: 'encrypt', key: publicKey, cipherFormat: format, input: plaintext });
    const options = { operation: 'decrypt', key: privateKey, cipherFormat: format, input: encrypted.output };
    assert.equal((await executeSm2(options)).output, plaintext);
    const corrupted = Buffer.from(encrypted.output, 'base64'); corrupted[corrupted.length - 1] ^= 1;
    await assert.rejects(executeSm2({ ...options, input: corrupted.toString('base64') }));
    const other = await executeSm2({ operation: 'keygen' });
    await assert.rejects(executeSm2({ ...options, key: other.privateKey }));
  });
}
for (const userId of ['1234567812345678', 'offline-user-42']) {
  test(`OpenSSL signature -> adapter verification with bound ID ${userId}`, async () => {
    openssl('dgst', '-sm3', '-sign', file('key.pem'), '-sigopt', 'distid:' + userId, '-out', file('native-signature'), file('input'));
    const signature = fs.readFileSync(file('native-signature')).toString('base64');
    const options = { operation: 'verify', key: publicKey, input: plaintext, signature, signatureFormat: 'der', userId };
    assert.equal((await executeSm2(options)).valid, true);
    assert.equal((await executeSm2({ ...options, userId: userId + '-wrong' })).valid, false);
    assert.equal((await executeSm2({ ...options, input: plaintext + 'x' })).valid, false);
  });
  test(`adapter signature -> OpenSSL verification with bound ID ${userId}`, async () => {
    const signed = await executeSm2({ operation: 'sign', key: privateKey, input: plaintext, userId, signatureFormat: 'der' });
    fs.writeFileSync(file('our-signature'), Buffer.from(signed.output, 'base64'));
    assert.match(openssl('dgst', '-sm3', '-verify', file('public.pem'), '-sigopt', 'distid:' + userId, '-signature', file('our-signature'), file('input')), /Verified OK/);
  });
}
test('raw signature format verifies and refuses zero/out-of-range scalars', async () => {
  const signed = await executeSm2({ operation: 'sign', key: privateKey, input: plaintext, signatureFormat: 'raw', outputEncoding: 'hex' });
  assert.equal(signed.output.length, 128);
  const options = { operation: 'verify', key: publicKey, input: plaintext, signatureFormat: 'raw', signatureEncoding: 'hex' };
  assert.equal((await executeSm2({ ...options, signature: signed.output })).valid, true);
  for (const signature of ['00'.repeat(64), 'ff'.repeat(64), '00']) assert.equal((await executeSm2({ ...options, signature })).valid, false);
});
test('invalid curve points, malformed DER, bad encodings and empty ciphertext reject', async () => {
  for (const key of ['04' + '00'.repeat(64), '00', 'ff'.repeat(65)]) {
    await assert.rejects(executeSm2({ operation: 'encrypt', key, input: plaintext }));
  }
  for (const key of ['00'.repeat(32), 'ff'.repeat(32), '01']) {
    await assert.rejects(executeSm2({ operation: 'sign', key, input: plaintext }));
  }
  for (const input of ['', 'AA==', 'MAA=', '%', 'MIAAAA==']) {
    await assert.rejects(executeSm2({ operation: 'decrypt', key: privateKey, cipherFormat: 'der', input }));
  }
  await assert.rejects(executeSm2({ operation: 'encrypt', key: publicKey, input: '' }));
});
test('one-byte plaintext never uses an all-zero derived mask', async () => {
  for (let index = 0; index < 64; index++) {
    const encrypted = await executeSm2({ operation: 'encrypt', key: publicKey, input: '00', inputEncoding: 'hex', outputEncoding: 'hex' });
    assert.notEqual(encrypted.output.slice(-2), '00');
    assert.equal((await executeSm2({ operation: 'decrypt', key: privateKey, input: encrypted.output, inputEncoding: 'hex', outputEncoding: 'hex' })).output, '00');
  }
});
