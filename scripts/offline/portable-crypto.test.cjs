'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const dir = path.resolve(__dirname, '../../packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools');
const oldRandom = Math.random;
const oldLoad = Module._load;
let forbiddenCalls = 0;
Math.random = () => { forbiddenCalls++; throw new Error('Non-cryptographic randomness forbidden'); };
Module._load = function (id, ...args) {
  if (['http', 'https', 'net', 'tls', 'dns', 'dgram', 'child_process', 'electron', 'undici'].includes(id.replace(/^node:/, ''))) {
    forbiddenCalls++; throw new Error('Offline primitives attempted network/process access');
  }
  return oldLoad.call(this, id, ...args);
};
let core;
let primitive;
try {
  core = require(path.join(dir, 'crypto-core.cjs'));
  primitive = require(path.join(dir, 'primitives.generated.cjs'));
} finally { Module._load = oldLoad; Math.random = oldRandom; }
const run = core.execute;
const privateKey = '0'.repeat(63) + '1'; // Public test vector only; never a default application key.
const publicKey = '0432c4ae2c1f1981195f9904466a39c9948fe30bbff2660be1715a4589334c74c7bc3736a2f4f6779c59bdcee36b692153d0a9877cc62a474002df32e52139f0a0';

test('bundle provenance matches exact bytes, four pinned inputs and packaged licenses', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'PRIMITIVES.json'), 'utf8'));
  const bytes = fs.readFileSync(path.join(dir, manifest.bundle));
  assert.equal(bytes.length, manifest.bytes);
  assert.ok(bytes.length < 512 * 1024);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.equal(manifest.packages.length, 4);
  const notices = fs.readFileSync(path.join(dir, 'PRIMITIVES-LICENSE.txt'), 'utf8');
  for (const pkg of manifest.packages) {
    assert.equal(pkg.license, 'MIT'); assert.match(pkg.integrity, /^sha512-/);
    assert.ok(notices.includes(pkg.name + '@' + pkg.version));
  }
  assert.equal(forbiddenCalls, 0);
});
test('SM3 and FIPS SHA3 known answers work even when native hashes are unavailable', async () => {
  const oldHashes = crypto.getHashes;
  const oldHash = crypto.createHash;
  try {
    crypto.getHashes = () => [];
    crypto.createHash = () => { throw new Error('Native hash deliberately unavailable'); };
    assert.equal((await run({ action: 'digest', algorithm: 'sm3', input: 'abc' })).output,
      '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0');
    assert.equal((await run({ action: 'digest', algorithm: 'sha3-256', input: 'abc' })).output,
      '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');
  } finally { crypto.getHashes = oldHashes; crypto.createHash = oldHash; }
});
for (const algorithm of ['sm3', 'sha3-224', 'sha3-256', 'sha3-384', 'sha3-512']) {
  test(`${algorithm} digest and HMAC preserve binary, empty and Unicode input`, async () => {
    for (const input of ['', '0001ff80', Buffer.from('中文 🔐').toString('hex'), '61'.repeat(200)]) {
      const bytes = Buffer.from(input, 'hex');
      const hmacKey = crypto.randomBytes(32);
      const digest = await run({ action: 'digest', algorithm, input, inputEncoding: 'hex' });
      const mac = await run({ action: 'hmac', algorithm, input, inputEncoding: 'hex', key: hmacKey.toString('hex'), keyEncoding: 'hex' });
      assert.match(digest.output, /^[0-9a-f]+$/); assert.equal(mac.output.length, digest.output.length);
      assert.notEqual(mac.output, digest.output);
      // OpenSSL on the build host is an independent reference; Electron is separately
      // required to execute the same inputs even when it lacks the native algorithms.
      if (crypto.getHashes().includes(algorithm)) {
        assert.equal(digest.output, crypto.createHash(algorithm).update(bytes).digest('hex'));
        assert.equal(mac.output, crypto.createHmac(algorithm, hmacKey).update(bytes).digest('hex'));
      }
    }
  });
}
test('SM4 known answer is independent of runtime cipher availability', async () => {
  const original = crypto.getCiphers;
  crypto.getCiphers = () => [];
  try {
    const result = await run({ action: 'cipher', algorithm: 'sm4-cbc', operation: 'encrypt',
      key: '0123456789abcdeffedcba9876543210', iv: '00'.repeat(16), padding: 'none',
      input: '0123456789abcdeffedcba9876543210', inputEncoding: 'hex', outputEncoding: 'hex' });
    assert.equal(result.output, '681edf34d206965e86b3e94f536e4246');
  } finally { crypto.getCiphers = original; }
});
for (const mode of ['cbc', 'ctr']) {
  test(`SM4-${mode} interoperates with OpenSSL for varied byte lengths`, async () => {
    for (const count of [0, 1, 15, 16, 17, 31, 32, 65, 1024]) {
      const data = Buffer.alloc(count, 0xff);
      const options = { action: 'cipher', algorithm: 'sm4-' + mode, operation: 'encrypt',
        key: '12'.repeat(16), iv: '34'.repeat(16), input: data.toString('hex'), inputEncoding: 'hex', outputEncoding: 'hex' };
      const encrypted = await run(options);
      const decrypted = await run({ ...options, operation: 'decrypt', input: encrypted.output });
      assert.equal(decrypted.output, data.toString('hex'));
      if (crypto.getCiphers().includes(options.algorithm)) {
        const cipher = crypto.createCipheriv(options.algorithm, Buffer.from(options.key, 'hex'), Buffer.from(options.iv, 'hex'));
        assert.equal(encrypted.output, Buffer.concat([cipher.update(data), cipher.final()]).toString('hex'));
      }
    }
  });
}
test('SM4 rejects zero/oversized/mismatched padding and partial blocks', async () => {
  const options = { action: 'cipher', algorithm: 'sm4-cbc', operation: 'encrypt', key: '11'.repeat(16),
    iv: '22'.repeat(16), padding: 'none', inputEncoding: 'hex', outputEncoding: 'hex' };
  for (const plain of ['00'.repeat(16), '11'.repeat(16), '00'.repeat(14) + '0102']) {
    const encrypted = await run({ ...options, input: plain });
    await assert.rejects(run({ ...options, operation: 'decrypt', input: encrypted.output, padding: 'pkcs7' }));
  }
  for (const input of ['', '00', '00'.repeat(17)]) {
    await assert.rejects(run({ ...options, operation: 'decrypt', input, padding: 'pkcs7' }));
  }
  await assert.rejects(run({ ...options, input: '00', padding: 'none' }));
  await assert.rejects(run({ ...options, algorithm: 'sm4-ctr', iv: 'ff'.repeat(16), input: '00'.repeat(17) }));
});
test('SM2 uses the standard generator and never Math.random, even for ephemeral scalars', async () => {
  assert.equal(primitive.sm2.getPublicKeyFromPrivateKey(privateKey), publicKey);
  Math.random = () => { throw new Error('Insecure RNG'); };
  try {
    const a = await run({ action: 'keygen', algorithm: 'sm2' });
    const b = await run({ action: 'keygen', algorithm: 'sm2' });
    assert.notEqual(a.privateKey, b.privateKey);
    const first = await run({ action: 'sm2', operation: 'encrypt', key: a.publicKey, input: '安全随机数' });
    const next = await run({ action: 'sm2', operation: 'encrypt', key: a.publicKey, input: '安全随机数' });
    assert.notEqual(first.output, next.output);
    const signature = await run({ action: 'sm2', operation: 'sign', key: a.privateKey, input: 'message' });
    assert.equal((await run({ action: 'sm2', operation: 'verify', key: a.publicKey, input: 'message', signature: signature.output })).valid, true);
  } finally { Math.random = oldRandom; }
});
for (const cipherMode of ['c1c3c2', 'c1c2c3']) {
  test(`SM2 ${cipherMode} binary/Unicode roundtrip rejects wrong keys, invalid C1 and every ciphertext component tamper`, async () => {
    for (const input of ['中文 🗝', 'x', '\0\u007f']) {
      const encrypted = await run({ action: 'sm2', operation: 'encrypt', key: publicKey, input, cipherMode });
      assert.equal((await run({ action: 'sm2', operation: 'decrypt', key: privateKey, input: encrypted.output, cipherMode })).output, input);
      for (const position of [0, 1, 64, 65, Buffer.from(encrypted.output, 'base64').length - 1]) {
        const tampered = Buffer.from(encrypted.output, 'base64'); tampered[position] ^= 1;
        await assert.rejects(run({ action: 'sm2', operation: 'decrypt', key: privateKey, input: tampered.toString('base64'), cipherMode }));
      }
      await assert.rejects(run({ action: 'sm2', operation: 'decrypt', key: '0'.repeat(63) + '2', input: encrypted.output, cipherMode }));
    }
  });
}
for (const signatureFormat of ['raw', 'der']) {
  test(`SM2 ${signatureFormat} signatures bind message and user ID and reject malformed signatures`, async () => {
    const signed = await run({ action: 'sm2', operation: 'sign', key: privateKey, input: '', userId: '中国', signatureFormat });
    const options = { action: 'sm2', operation: 'verify', key: publicKey, input: '', userId: '中国', signature: signed.output, signatureFormat };
    assert.equal((await run(options)).valid, true);
    assert.equal((await run({ ...options, userId: 'other' })).valid, false);
    assert.equal((await run({ ...options, input: 'changed' })).valid, false);
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(64), Buffer.alloc(64, 255), Buffer.concat([Buffer.from(signed.output, 'base64'), Buffer.from([0])])]) {
      assert.equal((await run({ ...options, signature: bytes.toString('base64') })).valid, false);
    }
  });
}
test('SM2 refuses invalid scalars, off-curve points, empty encryption, wrong modes and overlong user IDs', async () => {
  for (const key of ['', '00'.repeat(32), 'ff'.repeat(32), 'fffffffeffffffffffffffffffffffff7203df6b21c6052b53bbf40939d54122']) {
    await assert.rejects(run({ action: 'sm2', operation: 'sign', key, input: 'a' }));
  }
  for (const key of ['', '04' + '00'.repeat(64), '04' + 'ff'.repeat(64)]) {
    await assert.rejects(run({ action: 'sm2', operation: 'encrypt', key, input: 'a' }));
  }
  await assert.rejects(run({ action: 'sm2', operation: 'encrypt', key: publicKey, input: '' }));
  await assert.rejects(run({ action: 'sm2', operation: 'encrypt', key: publicKey, input: 'a', cipherMode: 'unknown' }));
  await assert.rejects(run({ action: 'sm2', operation: 'sign', key: privateKey, input: 'a', userId: 'x'.repeat(8192) }));
});
test('SM2 never returns plaintext when upstream reports integrity failure and retries all-zero KDF', async () => {
  const decrypt = primitive.sm2.doDecrypt;
  const encrypt = primitive.sm2.doEncrypt;
  const raw = publicKey + '00'.repeat(32) + '61';
  try {
    primitive.sm2.doDecrypt = () => [];
    await assert.rejects(run({ action: 'sm2', operation: 'decrypt', key: privateKey, input: raw, inputEncoding: 'hex' }));
    let attempts = 0;
    primitive.sm2.doEncrypt = () => { attempts++; return raw.slice(2); };
    await assert.rejects(run({ action: 'sm2', operation: 'encrypt', key: publicKey, input: 'a' }));
    assert.equal(attempts, 128);
  } finally { primitive.sm2.doDecrypt = decrypt; primitive.sm2.doEncrypt = encrypt; }
});
