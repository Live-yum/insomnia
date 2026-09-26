'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { inspectDirectory, directoryViolations, inspectArchive } = require('./basic-budget.cjs');
const root = path.resolve(__dirname, '../..');
const profile = require(path.join(root, 'packages/insomnia/config/offline-basic.json'));
const config = require(path.join(root, 'packages/insomnia/electron-builder.basic.cjs'));
const budget = { unpackedMaxBytes: 20, fileCountMax: 2, directoryCountMax: 2, archiveMaxBytes: 10 };

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnia-basic-budget-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('basic distribution does not copy a community catalog or duplicate source tree', () => {
  assert.equal(config.asar, true);
  assert.deepEqual(config.extraResources, []);
  assert.deepEqual(profile.communityPlugins, []);
  assert.deepEqual(config.electronLanguages, ['zh-CN', 'en-US']);
  assert.ok(!JSON.stringify(config.files).includes('offline-plugin-resources'));
  assert.ok(config.files.some(item => typeof item === 'object' && item.to === './offline-reviewed-notices'));
});

test('preserve reviewed crypto providers without duplicate declared capabilities', () => {
  const actual = require(path.join(root, 'packages/insomnia/config/config.json')).bundlePlugins.map(p => p.name).sort();
  assert.deepEqual(profile.reviewedBundledPlugins.map(p => p.name).sort(), actual);
  const capabilities = profile.reviewedBundledPlugins.flatMap(p => p.capabilities);
  assert.equal(new Set(capabilities).size, capabilities.length);
  for (const plugin of profile.reviewedBundledPlugins) {
    const directory = path.join(root, 'packages/insomnia/src/vendor', plugin.name);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(metadata.dependencies || {}), []);
    assert.ok(fs.statSync(path.join(directory, 'LICENSE')).size > 0);
  }
});

test('request actual Chinese UI acceptance separately from engine locale resources', () => {
  assert.equal(profile.requestedDefaultUiLocale, 'zh-CN');
  assert.equal(profile.releaseAcceptance.actualChineseUiAndPersistence, true);
  assert.equal(config.extraMetadata.offlineRequestedUiLocale, 'zh-CN');
  assert.equal(profile.releaseAcceptance.requiredCryptoMatrix, true);
  assert.equal(profile.releaseAcceptance.nativePackagedTestsBothPlatforms, true);
});

test('measure regular files and directories independently', t => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'resources'));
  fs.writeFileSync(path.join(dir, 'resources/app.asar'), '12345');
  fs.writeFileSync(path.join(dir, 'insomnia'), '123');
  const report = inspectDirectory(dir);
  assert.equal(report.unpackedBytes, 8);
  assert.equal(report.fileCount, 2);
  assert.equal(report.directoryCount, 1);
  assert.deepEqual(directoryViolations(report, budget), []);
  assert.equal(report.largestFiles[0].path, 'resources/app.asar');
});

test('small compressed bytes cannot excuse too many extracted files', t => {
  const dir = fixture(t);
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(dir, String(i)), '1');
  assert.match(directoryViolations(inspectDirectory(dir), budget).join(' '), /fileCount/);
});

test('reject catalog folders and source maps even inside budget', t => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'offline-plugins'));
  fs.writeFileSync(path.join(dir, 'debug.js.map'), '{}');
  const report = inspectDirectory(dir);
  assert.deepEqual(report.forbiddenPaths, ['debug.js.map', 'offline-plugins']);
  assert.match(directoryViolations(report, budget).join(' '), /Unwanted/);
});

test('directory byte budget fails independently of file count', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'app.asar'), Buffer.alloc(21));
  assert.match(directoryViolations(inspectDirectory(dir), budget).join(' '), /unpackedBytes/);
});

test('archive budget rejects empty and oversized artifacts', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'portable.zip');
  fs.writeFileSync(file, Buffer.alloc(10));
  assert.deepEqual(inspectArchive(file, budget).violations, []);
  fs.writeFileSync(file, Buffer.alloc(11));
  assert.match(inspectArchive(file, budget).violations.join(' '), /archiveBytes/);
  fs.writeFileSync(file, '');
  assert.throws(() => inspectArchive(file, budget), /non-empty/);
});

test('missing limits fail rather than allow unlimited packages', () => {
  assert.throws(() => directoryViolations({ unpackedBytes: 0, fileCount: 0, directoryCount: 0, forbiddenPaths: [] }, {}), /Invalid budget/);
});

test('afterPack saves diagnostics before rejecting the package', async t => {
  const dir = fixture(t);
  const appOutDir = path.join(dir, 'app');
  fs.mkdirSync(appOutDir);
  fs.mkdirSync(path.join(appOutDir, 'offline-plugins'));
  await assert.rejects(config.afterPack({ appOutDir, outDir: dir, electronPlatformName: 'linux', arch: 3 }), /Compact package budget failed/);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'basic-budget-linux-3.json'), 'utf8'));
  assert.ok(report.violations.length > 0);
});
