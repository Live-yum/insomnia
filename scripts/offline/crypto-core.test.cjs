'use strict';
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const crypto = require('node:crypto');
const Module = require('node:module');
const previousLoad = Module._load;
const previousFetch = global.fetch;
let attempts = 0;
global.fetch = () => { attempts++; throw new Error('Network forbidden'); };
Module._load = function(id, ...args) {
  if (['http', 'https', 'net', 'tls', 'dns', 'dgram', 'child_process', 'electron', 'undici', 'fs', 'fs/promises'].includes(id.replace(/^node:/, ''))) {
    attempts++; throw new Error('No network, filesystem or process capability');
  }
  return previousLoad.call(this, id, ...args);
};
const { execute, decode } = require('../../packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools/crypto-core.cjs');
after(() => { Module._load = previousLoad; global.fetch = previousFetch; assert.equal(attempts, 0); });

const nistKey = '2b7e151628aed2a6abf7158809cf4f3c';
const nistPlain = '6bc1bee22e409f96e93d7e117393172a';
test('NIST SP800-38A AES-CBC known answer, not just a roundtrip', async () => {
  const result = await execute({ action: 'cipher', operation: 'encrypt', algorithm: 'aes-128-cbc', key: nistKey,
    iv: '000102030405060708090a0b0c0d0e0f', padding: 'none', input: nistPlain, inputEncoding: 'hex', outputEncoding: 'hex' });
  assert.equal(result.output, '7649abac8119b246cee98e9b12e9197d');
  assert.equal(result.authenticated, false);
  assert.match(result.warning, /not authenticated/);
});
test('NIST SP800-38A AES-CTR known answer', async () => {
  const result = await execute({ action: 'cipher', operation: 'encrypt', algorithm: 'aes-128-ctr', key: nistKey,
    iv: 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff', input: nistPlain, inputEncoding: 'hex', outputEncoding: 'hex' });
  assert.equal(result.output, '874d6191b620e3261bef6864990db6ce');
});
test('NIST AES-GCM zero-key known ciphertext and authentication tag', async () => {
  const result = await execute({ action: 'cipher', operation: 'encrypt', algorithm: 'aes-128-gcm', key: '00'.repeat(16),
    iv: '00'.repeat(12), input: '00'.repeat(16), inputEncoding: 'hex', outputEncoding: 'hex' });
  assert.equal(result.output, '0388dace60b6a392f328c2b971b2fe78');
  assert.equal(result.tag, 'ab6e47d42cec13bdf53a67b21257bddf');
});
for (const bits of [128, 192, 256]) {
  for (const mode of ['gcm', 'cbc', 'ctr']) {
    test(`AES-${bits}-${mode} empty/Unicode/binary roundtrip with fresh IVs`, async () => {
      const key = crypto.randomBytes(bits / 8).toString('hex');
      for (const input of ['', '正文 中文 🔒', '00ff80']) {
        const binary = input === '00ff80';
        const options = { action: 'cipher', operation: 'encrypt', algorithm: `aes-${bits}-${mode}`, key, input,
          inputEncoding: binary ? 'hex' : 'utf8', ...(mode === 'gcm' ? { aad: 'authenticated metadata' } : {}) };
        const encrypted = await execute(options);
        assert.notEqual(encrypted.iv, (await execute(options)).iv);
        const decoded = await execute({ ...options, operation: 'decrypt', input: encrypted.output, inputEncoding: 'base64',
          iv: encrypted.iv, tag: encrypted.tag, outputEncoding: binary ? 'hex' : 'utf8' });
        assert.equal(decoded.output, input);
      }
    });
  }
}
test('GCM rejects changed key, IV, AAD, ciphertext and tag without partial plaintext', async () => {
  const base = { action: 'cipher', operation: 'encrypt', algorithm: 'aes-256-gcm', key: '12'.repeat(32), input: 'private message', aad: 'metadata' };
  const encrypted = await execute(base);
  const decryption = { ...base, operation: 'decrypt', input: encrypted.output, inputEncoding: 'base64', iv: encrypted.iv, tag: encrypted.tag };
  const changed = Buffer.from(encrypted.output, 'base64'); changed[0] ^= 1;
  for (const patch of [{ key: '13'.repeat(32) }, { iv: '33'.repeat(12) }, { aad: 'changed' }, { tag: '00'.repeat(16) }, { input: changed.toString('base64') }]) {
    await assert.rejects(execute({ ...decryption, ...patch }));
  }
});
test('cipher rejects implicit decrypt IV, wrong lengths, unsupported padding and ECB', async () => {
  const base = { action: 'cipher', operation: 'encrypt', algorithm: 'aes-256-gcm', key: '12'.repeat(32), input: 'x' };
  for (const patch of [{ operation: 'decrypt' }, { key: '01' }, { iv: '00' }, { algorithm: 'aes-256-ecb' },
    { algorithm: 'aes-256-cbc', padding: 'bad' }, { algorithm: 'aes-256-ctr', aad: 'unexpected' }, { operation: 'invalid' }]) {
    await assert.rejects(execute({ ...base, ...patch }));
  }
});
test('SM3 GB/T32905 known answer for abc', async () => {
  assert.equal((await execute({ action: 'digest', algorithm: 'sm3', input: 'abc' })).output,
    '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0');
});
test('SM4 GB/T32907 single-block known answer through CBC zero IV', async () => {
  const result = await execute({ action: 'cipher', operation: 'encrypt', algorithm: 'sm4-cbc', key: '0123456789abcdeffedcba9876543210',
    iv: '00'.repeat(16), input: '0123456789abcdeffedcba9876543210', inputEncoding: 'hex', outputEncoding: 'hex', padding: 'none' });
  assert.equal(result.output, '681edf34d206965e86b3e94f536e4246');
});
test('SM4 CBC/CTR Unicode roundtrip', async () => {
  for (const algorithm of ['sm4-cbc', 'sm4-ctr']) {
    const options = { action: 'cipher', operation: 'encrypt', algorithm, key: '12'.repeat(16), input: '离线国密' };
    const encrypted = await execute(options);
    assert.equal((await execute({ ...options, operation: 'decrypt', input: encrypted.output, iv: encrypted.iv })).output, options.input);
  }
});
test('RFC4231 HMAC-SHA256 independently published vector', async () => {
  assert.equal((await execute({ action: 'hmac', algorithm: 'sha256', key: '0b'.repeat(20), keyEncoding: 'hex', input: 'Hi There' })).output,
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
});
test('legacy digests require explicit consent and return a warning', async () => {
  await assert.rejects(execute({ action: 'digest', algorithm: 'md5', input: 'abc' }));
  const result = await execute({ action: 'digest', algorithm: 'md5', input: 'abc', legacy: true });
  assert.equal(result.output, '900150983cd24fb0d6963f7d28e17f72');
  assert.ok(result.warning);
});
test('all supported encodings are canonical; invalid Unicode and binary UTF8 fail', async () => {
  for (const encoding of ['hex', 'base64', 'base64url']) {
    const result = await execute({ action: 'convert', input: '离线 🗝', outputEncoding: encoding });
    assert.equal((await execute({ action: 'convert', input: result.output, inputEncoding: encoding, outputEncoding: 'utf8' })).output, '离线 🗝');
  }
  for (const [value, encoding] of [['0', 'hex'], ['zz', 'hex'], ['AA', 'base64'], ['AB==', 'base64'], ['AA==', 'base64url'], ['A', 'base64url'], ['\ud800', 'utf8']]) {
    assert.throws(() => decode(value, encoding));
  }
  await assert.rejects(execute({ action: 'convert', input: 'ff', inputEncoding: 'hex', outputEncoding: 'utf8' }));
});
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = rsa.publicKey.export({ type: 'spki', format: 'pem' });
const privatePem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' });
test('RSA-OAEP interoperates with native API and supports explicit PEM/DER/JWK inputs', async () => {
  for (const format of ['pem', 'der', 'jwk']) {
    const publicKey = format === 'pem' ? publicPem : { format, data: format === 'jwk' ? rsa.publicKey.export({ format }) : rsa.publicKey.export({ type: 'spki', format }).toString('base64') };
    const privateKey = format === 'pem' ? privatePem : { format, data: format === 'jwk' ? rsa.privateKey.export({ format }) : rsa.privateKey.export({ type: 'pkcs8', format }).toString('base64') };
    const result = await execute({ action: 'rsa', operation: 'encrypt', key: publicKey, input: '本地 RSA', label: 'context' });
    const actual = crypto.privateDecrypt({ key: rsa.privateKey, oaepHash: 'sha256', oaepLabel: Buffer.from('context'), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(result.output, 'base64'));
    assert.equal(actual.toString(), '本地 RSA');
    assert.equal((await execute({ action: 'rsa', operation: 'decrypt', key: privateKey, input: result.output, label: 'context' })).output, '本地 RSA');
    await assert.rejects(execute({ action: 'rsa', operation: 'decrypt', key: privateKey, input: result.output, label: 'wrong' }));
  }
  await assert.rejects(execute({ action: 'rsa', operation: 'encrypt', key: publicPem, input: 'a'.repeat(191) }));
  await assert.rejects(execute({ action: 'rsa', operation: 'decrypt', key: publicPem, input: 'AA==' }));
});
for (const algorithm of ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA']) {
  test(`${algorithm} detached signatures and compact JWT verify correctly and reject tampering`, async () => {
    const pair = algorithm.startsWith('ES') ? await execute({ action: 'keygen', algorithm })
      : algorithm === 'EdDSA' ? await execute({ action: 'keygen', algorithm }) : { publicKey: publicPem, privateKey: privatePem };
    const signed = await execute({ action: 'sign', algorithm, key: pair.privateKey, input: 'signed 中文' });
    assert.equal((await execute({ action: 'verify', algorithm, key: pair.publicKey, input: 'signed 中文', signature: signed.output })).valid, true);
    assert.equal((await execute({ action: 'verify', algorithm, key: pair.publicKey, input: 'changed', signature: signed.output })).valid, false);
    const token = await execute({ action: 'jwt', operation: 'sign', algorithm, key: pair.privateKey, claims: { sub: 'local', exp: 200, nbf: 90, iss: 'test', aud: ['offline'] } });
    const verified = await execute({ action: 'jwt', operation: 'verify', algorithm, key: pair.publicKey, input: token.output, now: 100, issuer: 'test', audience: 'offline', requiredClaims: ['exp'] });
    assert.equal(verified.signatureVerified, true);
    assert.equal(verified.payload.sub, 'local');
    await assert.rejects(execute({ action: 'jwt', operation: 'verify', algorithm, key: pair.publicKey, input: token.output, now: 200 }));
  });
}
for (const algorithm of ['HS256', 'HS384', 'HS512']) {
  test(`${algorithm} enforces key strength, algorithm binding and all requested claims`, async () => {
    const key = 'K'.repeat(64);
    const token = await execute({ action: 'jwt', operation: 'sign', algorithm, key, claims: { exp: 200, nbf: 90, iss: 'local', aud: 'api' } });
    const options = { action: 'jwt', operation: 'verify', algorithm, key, input: token.output, now: 100, issuer: 'local', audience: 'api' };
    assert.equal((await execute(options)).signatureVerified, true);
    for (const patch of [{ now: 201 }, { now: 50 }, { issuer: 'other' }, { audience: 'other' }, { key: 'short' }, { requiredClaims: ['missing'] }, { algorithm: 'none' }]) {
      await assert.rejects(execute({ ...options, ...patch }));
    }
    const inspected = await execute({ action: 'jwt', operation: 'inspect', input: token.output });
    assert.equal(inspected.signatureVerified, false);
  });
}
test('JWT refuses header-selected keys, critical extensions, algorithm confusion and weak keys', async () => {
  const key = 's'.repeat(32);
  for (const header of [{ alg: 'none' }, { alg: 'HS256', jku: 'https://untrusted.invalid/keys' }, { alg: 'HS256', crit: [] }, { alg: 'HS256', b64: false }]) {
    const data = Buffer.from(JSON.stringify(header)).toString('base64url') + '.' + Buffer.from('{}').toString('base64url');
    const token = data + '.' + crypto.createHmac('sha256', key).update(data).digest('base64url');
    await assert.rejects(execute({ action: 'jwt', operation: 'verify', algorithm: 'HS256', key, input: token }));
  }
  await assert.rejects(execute({ action: 'jwt', operation: 'sign', algorithm: 'HS256', key: publicPem, claims: {} }));
  await assert.rejects(execute({ action: 'jwt', operation: 'sign', algorithm: 'HS256', key: 'short', claims: {} }));
  await assert.rejects(execute({ action: 'sign', algorithm: 'ES256', key: privatePem, input: 'x' }));
});
test('invalid NumericDate is rejected only after a valid signature', async () => {
  const key = 'k'.repeat(32);
  const token = await execute({ action: 'jwt', operation: 'sign', algorithm: 'HS256', key, claims: { exp: 'tomorrow' } });
  await assert.rejects(execute({ action: 'jwt', operation: 'verify', algorithm: 'HS256', key, input: token.output }));
});
test('keys and random data are explicit outputs, never persisted; lengths are bounded', async () => {
  for (const algorithm of ['aes-128', 'aes-192', 'aes-256', 'sm4', 'hmac-sha256', 'hmac-sha384', 'hmac-sha512']) {
    const first = await execute({ action: 'keygen', algorithm });
    assert.notEqual(first.output, (await execute({ action: 'keygen', algorithm })).output);
  }
  assert.equal((await execute({ action: 'random', bytes: 16 })).output.length, 32);
  for (const bytes of [0, -1, 1025, 1.5]) await assert.rejects(execute({ action: 'random', bytes }));
  await assert.rejects(execute({ action: 'random', bytes: 16, outputEncoding: 'unknown' }));
  await assert.rejects(execute({ action: 'unsupported' }));
  await assert.rejects(execute({ action: 'convert', input: 'x'.repeat(8 * 1024 * 1024 + 1) }));
});
