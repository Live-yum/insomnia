import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const outputDirectory = path.join(root, 'packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools');
const output = path.join(outputDirectory, 'sm2-provider.generated.cjs');
const lock = JSON.parse(await fs.readFile(path.join(directory, 'package-lock.json'), 'utf8'));
const expected = { 'sm-crypto-v2': '1.15.1', '@noble/curves': '1.9.7', '@noble/hashes': '1.8.0', '@noble/ciphers': '1.3.0' };
const manifest = {};
let licenseText = 'SM2 provider: pinned build inputs, MIT notices and source provenance\n\n';
for (const [name, version] of Object.entries(expected)) {
  const entry = lock.packages['node_modules/' + name];
  if (entry?.version !== version || !entry.integrity?.startsWith('sha512-') || !entry.resolved?.startsWith('https://registry.npmjs.org/')) throw new Error('Unexpected locked provider input: ' + name);
  const packageDirectory = path.join(directory, 'node_modules', name);
  const pkg = JSON.parse(await fs.readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
  if (pkg.version !== version || pkg.license !== 'MIT') throw new Error('Unexpected provider version or license');
  const names = await fs.readdir(packageDirectory);
  const notice = names.find(file => /^(LICENSE|LICENCE)(?:_MIT|\.md|\.txt)?$/i.test(file));
  if (!notice) throw new Error('Required license notice missing: ' + name);
  licenseText += `${name}@${version}\n${await fs.readFile(path.join(packageDirectory, notice), 'utf8')}\n\n`;
  manifest[name] = { version, resolved: entry.resolved, integrity: entry.integrity, repository: pkg.repository };
}
const result = await build({ absWorkingDir: directory, entryPoints: ['entry.mjs'], outfile: output,
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', minify: true, sourcemap: false,
  legalComments: 'inline', metafile: true,
  banner: { js: '// Generated from pinned MIT inputs. See SM2-NOTICE.txt and SM2-PROVENANCE.json. Do not edit.' } });
const bytes = await fs.readFile(output);
if (bytes.length > 400000) throw new Error('SM2 provider exceeds 400KB source budget');
const externals = Object.values(result.metafile.outputs).flatMap(value => value.imports).filter(item => item.external).map(item => item.path);
if (externals.some(name => !['crypto', 'node:crypto'].includes(name))) throw new Error('Unexpected external provider capability: ' + externals.join(', '));
const metadata = { generatedBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  dependencies: manifest, externalModules: [...new Set(externals)], compiler: 'esbuild@0.25.12',
  runtimeDependencies: [], securityAuditClaim: false,
  scope: 'SM2 encryption and SM3-based signatures only; wrapper adds strict points/scalars, failure handling and zero-KDF rejection' };
await fs.writeFile(path.join(outputDirectory, 'SM2-NOTICE.txt'), licenseText);
await fs.writeFile(path.join(outputDirectory, 'SM2-PROVENANCE.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata, null, 2));
