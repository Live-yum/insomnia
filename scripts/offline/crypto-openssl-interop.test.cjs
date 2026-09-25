'use strict';
// Independent OpenSSL CLI interoperation in CI only; never part of the runtime bundle.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const core = require('../../packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools/crypto-core.cjs');
function der(tag, content) {
  const len = content.length;
  const length = len < 128 ? Buffer.from([len]) : len < 256 ? Buffer.from([0x81, len]) : Buffer.from([0x82, len >> 8, len & 255]);
  return Buffer.concat([Buffer.from([tag]), length, content]);
}
function integer(raw) {
  while (raw.length > 1 && raw[0] === 0) raw = raw.subarray(1);
  if (raw[0] & 128) raw = Buffer.concat([Buffer.from([0]), raw]);
  return der(2, raw);
}
function parseSequence(bytes) {
  let pos = 0;
  function read() {
    const tag = bytes[pos++];
    let len = bytes[pos++];
    if (len & 128) { const n = len & 127; len = 0; for (let i = 0; i < n; i++) len = len * 256 + bytes[pos++]; }
    const data = bytes.subarray(pos, pos + len); pos += len;
    return { tag, data };
  }
  const seq = read(); assert.equal(seq.tag, 48); assert.equal(pos, bytes.length);
  bytes = seq.data; pos = 0;
  const result = []; while (pos < bytes.length) result.push(read());
  return result;
}
function coordinate(bytes) {
  if (bytes.length === 33) { assert.equal(bytes[0], 0); bytes = bytes.subarray(1); }
  assert.ok(bytes.length <= 32);
  return Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]);
}
test('SM2 encrypt/decrypt and user-ID-bound signing verify in BOTH directions with OpenSSL', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-sm2-interop-'));
  const file = name => path.join(temp, name);
  const openssl = args => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  try {
    const keys = await core.execute({ action: 'keygen', algorithm: 'sm2' });
    // PKCS8: id-ecPublicKey + sm2p256v1, ECPrivateKey with a 32-byte scalar.
    const ecPrivate = der(48, Buffer.concat([integer(Buffer.from([1])), der(4, Buffer.from(keys.privateKey, 'hex'))]));
    const alg = der(48, Buffer.from('06072a8648ce3d020106082a811ccf5501822d', 'hex'));
    const keyDer = der(48, Buffer.concat([integer(Buffer.from([0])), alg, der(4, ecPrivate)]));
    fs.writeFileSync(file('private.der'), keyDer, { mode: 0o600 });
    openssl(['pkey', '-inform', 'DER', '-in', file('private.der'), '-out', file('private.pem')]);
    openssl(['pkey', '-in', file('private.pem'), '-pubout', '-out', file('public.pem')]);
    const message = Buffer.from('independent SM2 interoperability 中文');
    fs.writeFileSync(file('message'), message);
    openssl(['pkeyutl', '-encrypt', '-pubin', '-inkey', file('public.pem'), '-in', file('message'), '-out', file('cipher.der')]);
    const parts = parseSequence(fs.readFileSync(file('cipher.der')));
    assert.deepEqual(parts.map(p => p.tag), [2, 2, 4, 4]); assert.equal(parts[2].data.length, 32);
    const raw = Buffer.concat([Buffer.from([4]), coordinate(parts[0].data), coordinate(parts[1].data), parts[2].data, parts[3].data]);
    assert.equal((await core.execute({ action: 'sm2', operation: 'decrypt', key: keys.privateKey, input: raw.toString('base64') })).output, message.toString());
    const ours = await core.execute({ action: 'sm2', operation: 'encrypt', key: keys.publicKey, input: message.toString() });
    const cipher = Buffer.from(ours.output, 'base64');
    fs.writeFileSync(file('ours.der'), der(48, Buffer.concat([integer(cipher.subarray(1,33)), integer(cipher.subarray(33,65)), der(4,cipher.subarray(65,97)), der(4,cipher.subarray(97))])));
    assert.deepEqual(openssl(['pkeyutl', '-decrypt', '-inkey', file('private.pem'), '-in', file('ours.der')]), message);
    const userId = 'offline-interop';
    openssl(['pkeyutl', '-sign', '-rawin', '-digest', 'sm3', '-pkeyopt', 'distid:' + userId, '-inkey', file('private.pem'), '-in', file('message'), '-out', file('signature')]);
    assert.equal((await core.execute({ action: 'sm2', operation: 'verify', key: keys.publicKey, input: message.toString(), userId,
      signature: fs.readFileSync(file('signature')).toString('base64'), signatureFormat: 'der' })).valid, true);
    const signed = await core.execute({ action: 'sm2', operation: 'sign', key: keys.privateKey, input: message.toString(), userId, signatureFormat: 'der' });
    fs.writeFileSync(file('ours.sig'), Buffer.from(signed.output, 'base64'));
    assert.match(openssl(['pkeyutl', '-verify', '-rawin', '-digest', 'sm3', '-pkeyopt', 'distid:' + userId, '-pubin', '-inkey', file('public.pem'), '-in', file('message'), '-sigfile', file('ours.sig')]).toString(), /success/i);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
