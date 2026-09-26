'use strict';
// Build-zone-only generation. All runtime inputs are bundled, bounded and recorded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..');
const input = path.join(__dirname, 'crypto-provider');
const output = path.join(root, 'packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools');
const expected = { 'sm-crypto-v2': '1.15.1', '@noble/curves': '1.9.7', '@noble/hashes': '1.8.0', '@noble/ciphers': '1.3.0' };
const lock = JSON.parse(fs.readFileSync(path.join(input, 'package-lock.json'), 'utf8'));
assert.equal(lock.lockfileVersion, 3);
const records = [];
let notices = 'Third-party cryptographic primitives, statically bundled for offline use.\n\n';
for (const [location, item] of Object.entries(lock.packages)) {
  if (!location) continue;
  assert.ok(location.startsWith('node_modules/'));
  const name = location.slice('node_modules/'.length);
  assert.equal(item.version, expected[name], 'Unexpected dependency: ' + location);
  assert.ok(item.resolved.startsWith('https://registry.npmjs.org/'));
  assert.match(item.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
  assert.ok(!item.hasInstallScript && !item.link);
  const dir = path.join(input, location);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, name); assert.equal(pkg.version, expected[name]);
  assert.equal(pkg.license, 'MIT');
  const licenseName = ['LICENSE', 'LICENSE.md', 'LICENCE_MIT', 'LICENSE.txt'].find(name => fs.existsSync(path.join(dir, name)));
  assert.ok(licenseName, 'Missing license for ' + name);
  const license = fs.readFileSync(path.join(dir, licenseName), 'utf8');
  notices += '=== ' + name + '@' + item.version + ' ===\n' + license + '\n\n';
  records.push({ name, version: item.version, resolved: item.resolved, integrity: item.integrity,
    license: pkg.license, licenseSha256: crypto.createHash('sha256').update(license).digest('hex') });
}
assert.equal(records.length, Object.keys(expected).length);
async function main() {
  const result = await esbuild.build({ entryPoints: [path.join(input, 'entry.cjs')], bundle: true, write: false,
    minify: true, legalComments: 'inline', platform: 'node', format: 'cjs', target: 'node22', metafile: true,
    define: { 'globalThis.crypto': '__OFFLINE_WEBCRYPTO', 'globalThis.wx': 'undefined' },
    banner: { js: '// Generated from pinned MIT-licensed sources; see PRIMITIVES-LICENSE.txt and PRIMITIVES.json.\nconst __OFFLINE_WEBCRYPTO = require("node:crypto").webcrypto;\nif (!__OFFLINE_WEBCRYPTO?.getRandomValues) throw new Error("A cryptographic RNG is required");' } });
  assert.equal(result.outputFiles.length, 1);
  for (const meta of Object.values(result.metafile.outputs)) {
    for (const item of meta.imports) assert.ok(item.external && ['crypto', 'node:crypto'].includes(item.path), 'Unexpected runtime dependency ' + item.path);
  }
  const bytes = result.outputFiles[0].contents;
  assert.ok(bytes.length > 10000 && bytes.length < 512 * 1024, 'Standalone crypto provider exceeds its 512 KiB budget');
  const bundle = path.join(output, 'primitives.generated.cjs');
  fs.writeFileSync(bundle, bytes);
  fs.writeFileSync(path.join(output, 'PRIMITIVES-LICENSE.txt'), notices);
  const manifest = { format: 1, buildOnly: true, packages: records.sort((a,b) => a.name.localeCompare(b.name)),
    generator: { name: 'esbuild', version: esbuild.version },
    bundle: 'primitives.generated.cjs', bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    cryptographicRandomness: 'Captured node:crypto.webcrypto.getRandomValues; no Math.random fallback',
    limitation: 'SM2/SM4 wrapper validation and interoperability are tested separately; this is not an independent security certification' };
  fs.writeFileSync(path.join(output, 'PRIMITIVES.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ bytes: bytes.length, sha256: manifest.sha256, packages: records.map(r => r.name + '@' + r.version) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
