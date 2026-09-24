'use strict';
const assert = require('node:assert/strict');
const { test, describe, it, beforeEach, after } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const vendor = path.join(root, 'packages/insomnia/src/vendor');
const load = Module._load;
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw new Error('Network/process access forbidden by offline plugin test'); };
const priorFetch = global.fetch;
global.fetch = deny;
Module._load = function (id, ...args) {
  if (id === 'mocha') return { describe, it, beforeEach };
  if (['http', 'https', 'net', 'tls', 'dns', 'dgram', 'child_process', 'electron', 'undici'].includes(id.replace(/^node:/, ''))) return deny();
  return load.call(this, id, ...args);
};
after(() => { Module._load = load; global.fetch = priorFetch; });
const upstream = require(path.join(vendor, 'insomnia-plugin-crypto/app.js'));
const aes = require(path.join(vendor, 'insomnia-plugin-crypto/encrypt.js'));
const tools = require(path.join(vendor, 'insomnia-plugin-offline-crypto-tools/index.cjs'));
const tag = name => tools.templateTags.find(t => t.name === name).run.bind(null, {});

// Execute the retained upstream tests without downloading Mocha.
require(path.join(vendor, 'insomnia-plugin-crypto/test/encrypt.test.js'));
require(path.join(vendor, 'insomnia-plugin-crypto/test/store.test.js'));

function context(env = {}, enabled = true) {
  let sentBody = { text: 'sensitive payload 中文' };
  let responseBody;
  let writes = 0;
  return {
    store: { getItem: async () => String(enabled), setItem: async () => {} },
    request: {
      getId: () => 'offline-test-request',
      getEnvironmentVariable: name => env[name],
      getBody: () => sentBody,
      setBody: value => { sentBody = value; writes++; },
    },
    response: { getBody: async () => Buffer.from(sentBody.text), setBody: value => { responseBody = value; } },
    app: { alert: () => { throw new Error('Unexpected error suppression via alert'); } },
    result: () => ({ sentBody, responseBody, writes }),
  };
}

test('both configured plugins have checked-in entrypoints, licenses and no npm runtime dependencies', () => {
  const config = require(path.join(root, 'packages/insomnia/config/config.json'));
  assert.equal(config.bundlePlugins.length, 2);
  for (const { name } of config.bundlePlugins) {
    const directory = path.join(vendor, name);
    const pkg = require(path.join(directory, 'package.json'));
    assert.equal(pkg.name, name);
    assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
    assert.equal(Object.keys(pkg.optionalDependencies || {}).length, 0);
    assert.ok(fs.statSync(path.join(directory, pkg.main)).size > 0);
    assert.ok(fs.statSync(path.join(directory, 'LICENSE')).size > 0);
  }
});
test('vendored upstream bytes match the committed SHA256 manifest', () => {
  const directory = path.join(vendor, 'insomnia-plugin-crypto');
  const manifest = require(path.join(directory, 'UPSTREAM.json'));
  assert.equal(manifest.revision, '769994ff8976233ead2e94a9054b3b4a72171485');
  for (const [file, expected] of Object.entries(manifest.sha256)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex'), expected, file);
  }
});
for (const bits of [128, 192, 256]) {
  test(`AES-${bits}-CBC request encryption and response decryption operate with no network`, async () => {
    const ctx = context({ 'crypto-alg': `aes-${bits}-cbc`, 'crypto-key': 'k'.repeat(bits / 8) });
    await upstream.requestHooks[0](ctx);
    assert.notEqual(ctx.result().sentBody.text, 'sensitive payload 中文');
    await upstream.responseHooks[0](ctx);
    assert.equal(ctx.result().responseBody, 'sensitive payload 中文');
  });
}
for (const env of [{}, { 'crypto-alg': 'aes-256-cbc', 'crypto-key': 'too-short' }, { 'crypto-alg': 'unknown', 'crypto-key': 'k'.repeat(32) }, { 'crypto-alg': 'aes-256-cbc', 'crypto-key': 'k'.repeat(32), 'crypto-base64': false }]) {
  test('encryption errors reject the hook and cannot silently fall back to plaintext', async () => {
    const ctx = context(env);
    await assert.rejects(upstream.requestHooks[0](ctx));
    assert.equal(ctx.result().writes, 0);
  });
}
test('disabled encryption leaves ordinary API requests unchanged', async () => {
  const ctx = context({}, false);
  await upstream.requestHooks[0](ctx);
  assert.equal(ctx.result().writes, 0);
});
test('CBC uses fresh IVs for repeated plaintext', () => {
  assert.notDeepEqual(aes.encrypt('same', 'aes-256-cbc', 'k'.repeat(32)), aes.encrypt('same', 'aes-256-cbc', 'k'.repeat(32)));
});
test('AES-GCM roundtrip authenticates Unicode and empty plaintext', () => {
  const key = crypto.randomBytes(32).toString('base64');
  for (const input of ['', 'secret 中文 🗝️']) {
    const cipher = tag('offlineAesGcm')('encrypt', input, key);
    assert.equal(tag('offlineAesGcm')('decrypt', cipher, key), input);
    assert.notEqual(tag('offlineAesGcm')('encrypt', input, key), cipher);
  }
});
test('AES-GCM refuses tampering, invalid encodings, wrong keys and truncated envelopes', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const encoded = tag('offlineAesGcm')('encrypt', 'sensitive', key);
  const tampered = Buffer.from(encoded, 'base64'); tampered[20] ^= 1;
  assert.throws(() => tag('offlineAesGcm')('decrypt', tampered.toString('base64'), key));
  assert.throws(() => tag('offlineAesGcm')('decrypt', encoded, crypto.randomBytes(32).toString('base64')));
  for (const input of ['%', 'AA==', encoded.slice(0, 8)]) assert.throws(() => tag('offlineAesGcm')('decrypt', input, key));
  assert.throws(() => tag('offlineAesGcm')('encrypt', 'data', 'short'));
});
test('HMAC SHA256 matches RFC4231 test case 1', () => {
  assert.equal(tag('offlineHmac')('sha256', 'Hi There', '\x0b'.repeat(20), 'hex'), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
});
test('RSA-OAEP SHA256 roundtrip and damaged ciphertext rejection', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const encrypted = tag('offlineRsaOaep')('encrypt', 'small secret 中文', publicKey);
  assert.equal(tag('offlineRsaOaep')('decrypt', encrypted, privateKey), 'small secret 中文');
  const damaged = Buffer.from(encrypted, 'base64'); damaged[0] ^= 1;
  assert.throws(() => tag('offlineRsaOaep')('decrypt', damaged.toString('base64'), privateKey));
});
test('JWT inspection is explicitly NOT signature verification', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'test' })).toString('base64url');
  assert.deepEqual(JSON.parse(tag('offlineJwtPayload')(`e30.${payload}.unverified`)), { sub: 'test' });
  assert.match(tools.templateTags.find(t => t.name === 'offlineJwtPayload').displayName, /NOT verified/);
  assert.throws(() => tag('offlineJwtPayload')('invalid'));
});
test('module loading and all exercised plugin functions attempted no network/process access', () => {
  assert.equal(networkAttempts, 0);
});
