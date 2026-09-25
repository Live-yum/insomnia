import assert from 'node:assert/strict';

/** Exercise the packaged host, not a Node import of the implementation. */
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
  let checks = 0;
  for (const bits of [128, 192, 256]) {
    for (const mode of ['gcm', 'cbc', 'ctr']) {
      const options = { action: 'cipher', operation: 'encrypt', algorithm: `aes-${bits}-${mode}`,
        key: '12'.repeat(bits / 8), input: '00ff8000', inputEncoding: 'hex', outputEncoding: 'base64' };
      const encrypted = await run(options);
      assert.notEqual(encrypted.iv, (await run(options)).iv);
      const decrypted = await run({ ...options, operation: 'decrypt', input: encrypted.output,
        inputEncoding: 'base64', outputEncoding: 'hex', iv: encrypted.iv, tag: encrypted.tag });
      assert.equal(decrypted.output, options.input);
      if (mode === 'gcm') {
        await assert.rejects(run({ ...options, operation: 'decrypt', input: encrypted.output,
          inputEncoding: 'base64', iv: encrypted.iv, tag: '00'.repeat(16) }));
      }
      checks++;
    }
  }
  assert.equal((await run({ action: 'digest', algorithm: 'sm3', input: 'abc' })).output,
    '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0');
  assert.equal((await run({ action: 'cipher', algorithm: 'sm4-cbc', operation: 'encrypt',
    key: '0123456789abcdeffedcba9876543210', iv: '00'.repeat(16), padding: 'none',
    input: '0123456789abcdeffedcba9876543210', inputEncoding: 'hex', outputEncoding: 'hex' })).output,
    '681edf34d206965e86b3e94f536e4246');
  checks += 2;
  const rsa = await run({ action: 'keygen', algorithm: 'rsa', bits: 2048 });
  const encrypted = await run({ action: 'rsa', operation: 'encrypt', key: rsa.publicKey, input: '离线 RSA' });
  assert.equal((await run({ action: 'rsa', operation: 'decrypt', key: rsa.privateKey, input: encrypted.output })).output, '离线 RSA');
  checks++;
  for (const algorithm of ['RS256', 'PS256', 'ES256', 'ES384', 'ES512', 'EdDSA']) {
    const keys = algorithm.startsWith('RS') || algorithm.startsWith('PS') ? rsa : await run({ action: 'keygen', algorithm });
    const signed = await run({ action: 'sign', algorithm, key: keys.privateKey, input: '签名正文' });
    assert.equal((await run({ action: 'verify', algorithm, key: keys.publicKey, input: '签名正文', signature: signed.output })).valid, true);
    assert.equal((await run({ action: 'verify', algorithm, key: keys.publicKey, input: '篡改', signature: signed.output })).valid, false);
    const jwt = await run({ action: 'jwt', operation: 'sign', algorithm, key: keys.privateKey,
      claims: { exp: 200, nbf: 90, iss: 'offline', aud: ['test'] } });
    assert.equal((await run({ action: 'jwt', operation: 'verify', algorithm, key: keys.publicKey,
      input: jwt.output, now: 100, issuer: 'offline', audience: 'test' })).signatureVerified, true);
    await assert.rejects(run({ action: 'jwt', operation: 'verify', algorithm, key: keys.publicKey, input: jwt.output, now: 200 }));
    checks++;
  }
  for (const algorithm of ['HS256', 'HS384', 'HS512']) {
    const key = 'K'.repeat(64);
    const jwt = await run({ action: 'jwt', operation: 'sign', algorithm, key, claims: { exp: 200 } });
    assert.equal((await run({ action: 'jwt', operation: 'verify', algorithm, key, input: jwt.output, now: 100 })).signatureVerified, true);
    await assert.rejects(run({ action: 'jwt', operation: 'verify', algorithm, key: 'L'.repeat(64), input: jwt.output, now: 100 }));
    checks++;
  }
  for (const encoding of ['hex', 'base64', 'base64url']) {
    const encoded = await run({ action: 'convert', input: '编码 中文 🔒', outputEncoding: encoding });
    assert.equal((await run({ action: 'convert', input: encoded.output, inputEncoding: encoding, outputEncoding: 'utf8' })).output, '编码 中文 🔒');
    checks++;
  }
  return { authenticatedPackagedCryptoBridge: true, cryptoBridgeChecks: checks };
}
