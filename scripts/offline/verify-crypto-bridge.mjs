import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/** Exercise the packaged authenticated host, never a direct import of its implementation. */
export async function verifyCryptoBridge(page) {
  const run = options => page.evaluate(async options => {
    const token = await window.main.templatingDb.getAuthToken();
    const response = await fetch('insomnia-templating-worker-database://plugin.executeBundlePluginTag', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-insomnia-templating-auth': token },
      body: JSON.stringify({ pluginName: 'insomnia-plugin-offline-crypto-tools', tagName: 'offlineCrypto',
        args: [JSON.stringify(options), 'json'], context: { meta: {}, context: {}, renderPurpose: 'preview' } }),
    });
    if (!response.ok) throw new Error(await response.text());
    return JSON.parse(await response.json());
  }, options);
  const checks = [];
  for (const bits of [128, 192, 256]) {
    for (const mode of ['gcm', 'cbc', 'ctr']) {
      const options = { action: 'cipher', operation: 'encrypt', algorithm: `aes-${bits}-${mode}`,
        key: randomBytes(bits / 8).toString('hex'), input: '00ff8000', inputEncoding: 'hex', outputEncoding: 'base64' };
      const encrypted = await run(options);
      assert.notEqual(encrypted.iv, (await run(options)).iv);
      const decrypted = await run({ ...options, operation: 'decrypt', input: encrypted.output,
        inputEncoding: 'base64', outputEncoding: 'hex', iv: encrypted.iv, tag: encrypted.tag });
      assert.equal(decrypted.output, options.input);
      if (mode === 'gcm') {
        await assert.rejects(run({ ...options, operation: 'decrypt', input: encrypted.output,
          inputEncoding: 'base64', iv: encrypted.iv, tag: '00'.repeat(16) }));
      }
      checks.push(options.algorithm);
    }
  }
  assert.equal((await run({ action: 'digest', algorithm: 'sm3', input: 'abc' })).output,
    '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0');
  assert.equal((await run({ action: 'digest', algorithm: 'sha3-256', input: 'abc' })).output,
    '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');
  assert.equal((await run({ action: 'cipher', algorithm: 'sm4-cbc', operation: 'encrypt',
    key: '0123456789abcdeffedcba9876543210', iv: '00'.repeat(16), padding: 'none',
    input: '0123456789abcdeffedcba9876543210', inputEncoding: 'hex', outputEncoding: 'hex' })).output,
    '681edf34d206965e86b3e94f536e4246');
  checks.push('sm3-known-answer', 'sha3-known-answer', 'sm4-known-answer');
  for (const algorithm of ['sm4-cbc', 'sm4-ctr']) {
    const key = randomBytes(16).toString('hex');
    const encrypted = await run({ action: 'cipher', algorithm, operation: 'encrypt', input: '国密正文 🔐', key });
    assert.equal((await run({ action: 'cipher', algorithm, operation: 'decrypt', input: encrypted.output,
      key, iv: encrypted.iv, inputEncoding: 'base64', outputEncoding: 'utf8' })).output, '国密正文 🔐');
    checks.push(algorithm);
  }
  const sm2 = await run({ action: 'keygen', algorithm: 'sm2' });
  for (const cipherMode of ['c1c3c2', 'c1c2c3']) {
    const encrypted = await run({ action: 'sm2', operation: 'encrypt', key: sm2.publicKey, input: 'SM2 离线正文', cipherMode });
    assert.equal((await run({ action: 'sm2', operation: 'decrypt', key: sm2.privateKey, input: encrypted.output, cipherMode })).output, 'SM2 离线正文');
    const tampered = Buffer.from(encrypted.output, 'base64');
    tampered[tampered.length - 1] ^= 1;
    await assert.rejects(run({ action: 'sm2', operation: 'decrypt', key: sm2.privateKey, input: tampered.toString('base64'), cipherMode }));
    checks.push('sm2-' + cipherMode);
  }
  for (const signatureFormat of ['raw', 'der']) {
    const signed = await run({ action: 'sm2', operation: 'sign', key: sm2.privateKey, input: '签名正文', userId: '中文用户', signatureFormat });
    const verify = { action: 'sm2', operation: 'verify', key: sm2.publicKey, input: '签名正文', userId: '中文用户', signatureFormat, signature: signed.output };
    assert.equal((await run(verify)).valid, true);
    assert.equal((await run({ ...verify, userId: 'other' })).valid, false);
    assert.equal((await run({ ...verify, input: 'tampered' })).valid, false);
    checks.push('sm2-sign-' + signatureFormat);
  }
  const rsa = await run({ action: 'keygen', algorithm: 'rsa', bits: 2048 });
  const encrypted = await run({ action: 'rsa', operation: 'encrypt', key: rsa.publicKey, input: '离线 RSA' });
  assert.equal((await run({ action: 'rsa', operation: 'decrypt', key: rsa.privateKey, input: encrypted.output })).output, '离线 RSA');
  checks.push('rsa-oaep');
  for (const algorithm of ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA']) {
    const keys = algorithm.startsWith('RS') || algorithm.startsWith('PS') ? rsa : await run({ action: 'keygen', algorithm });
    const signed = await run({ action: 'sign', algorithm, key: keys.privateKey, input: '签名正文' });
    assert.equal((await run({ action: 'verify', algorithm, key: keys.publicKey, input: '签名正文', signature: signed.output })).valid, true);
    assert.equal((await run({ action: 'verify', algorithm, key: keys.publicKey, input: '篡改', signature: signed.output })).valid, false);
    const jwt = await run({ action: 'jwt', operation: 'sign', algorithm, key: keys.privateKey,
      claims: { exp: 200, nbf: 90, iss: 'offline', aud: ['test'] } });
    assert.equal((await run({ action: 'jwt', operation: 'verify', algorithm, key: keys.publicKey,
      input: jwt.output, now: 100, issuer: 'offline', audience: 'test' })).signatureVerified, true);
    await assert.rejects(run({ action: 'jwt', operation: 'verify', algorithm, key: keys.publicKey, input: jwt.output, now: 200 }));
    await assert.rejects(run({ action: 'jwt', operation: 'verify', algorithm, key: keys.publicKey, input: jwt.output, now: 100, audience: 'wrong' }));
    checks.push('signature-and-jws-' + algorithm);
  }
  for (const algorithm of ['HS256', 'HS384', 'HS512']) {
    const key = randomBytes(64).toString('base64');
    const jwt = await run({ action: 'jwt', operation: 'sign', algorithm, key, claims: { exp: 200 } });
    assert.equal((await run({ action: 'jwt', operation: 'verify', algorithm, key, input: jwt.output, now: 100 })).signatureVerified, true);
    await assert.rejects(run({ action: 'jwt', operation: 'verify', algorithm, key: randomBytes(64).toString('base64'), input: jwt.output, now: 100 }));
    checks.push('jws-' + algorithm);
  }
  for (const encoding of ['hex', 'base64', 'base64url']) {
    const encoded = await run({ action: 'convert', input: '编码 中文 🔒', outputEncoding: encoding });
    assert.equal((await run({ action: 'convert', input: encoded.output, inputEncoding: encoding, outputEncoding: 'utf8' })).output, '编码 中文 🔒');
    checks.push('encoding-' + encoding);
  }
  return { authenticatedPackagedCryptoBridge: true, cryptoBridgeChecks: checks.length, cryptoBridgeCoverage: checks,
    packagedSm2Sm3Sm4Verified: true, packagedAuthenticatedDecryptionRejectsTampering: true };
}
