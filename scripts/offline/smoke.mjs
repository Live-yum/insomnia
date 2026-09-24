import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { _electron as electron } from 'playwright';

if (!process.argv[2]) throw new Error('Usage: node scripts/offline/smoke.mjs <packaged-executable>');
const executablePath = path.resolve(process.argv[2]);
const directory = path.dirname(executablePath);
const resourceRoot = path.join(directory, 'resources/offline-plugins');
const catalog = JSON.parse(await readFile(path.join(resourceRoot, 'catalog.json'), 'utf8'));
const prepared = catalog.entries.filter(e => e.status === 'materialized-unreviewed');
assert(prepared.length > 50, 'A full catalog, not a selected handful of plugins, must be packaged.');
const expected = [];
const incompatibleManifests = [];
for (const entry of prepared) {
  assert(/^[0-9a-f]{20}$/.test(entry.profile));
  assert(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(entry.name));
  const manifest = JSON.parse(await readFile(path.join(resourceRoot, entry.profile, 'node_modules', entry.name, 'package.json'), 'utf8'));
  assert.equal(manifest.name, entry.name, 'Packaged plugin identity must match the catalog.');
  if (!manifest.insomnia || typeof manifest.insomnia !== 'object') {
    // Source archives stay in the distribution for audit, but a package without the
    // host's required manifest field must not be falsely counted as loadable.
    incompatibleManifests.push({ name: entry.name, reason: 'Missing required insomnia plugin metadata' });
  } else {
    expected.push(entry.name);
  }
}
const profile = await mkdtemp(path.join(os.tmpdir(), 'insomnia-offline-smoke-'));
const env = { ...process.env, INSOMNIA_OFFLINE_DATA_PATH: profile };
for (const key of ['INSOMNIA_DATA_PATH', 'INSOMNIA_SESSION', 'INSOMNIA_OFFLINE_BROWSER_ORIGINS', 'INSOMNIA_OFFLINE_PLUGIN_DIR', 'GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN']) delete env[key];
let app;
const report = {
  sourceCommit: process.env.GITHUB_SHA,
  expectedPlugins: expected.length,
  incompatibleManifests,
  archiveExceptions: catalog.entries.filter(e => e.status !== 'materialized-unreviewed').map(e => ({ name: e.name, status: e.status, error: e.error })),
  passed: false,
  allCatalogPluginsUsable: false,
  scope: 'Packaged startup, account-free local route, disabled-plugin enumeration and Chromium URL policy; not all plugin functionality or an OS-level egress audit.',
};
try {
  app = await electron.launch({ executablePath, env, timeout: 120_000 });
  const page = await app.firstWindow({ timeout: 120_000 });
  page.setDefaultTimeout(120_000);
  await page.waitForURL(url => url.pathname.startsWith('/organization/org_offline/'));
  await page.getByTestId('offline-mode').waitFor({ state: 'visible' });
  const plugins = await page.evaluate(() => window.main.plugins.getPlugins());
  const names = new Set(plugins.map(p => p.name));
  const missing = expected.filter(name => !names.has(name));
  assert.deepEqual(missing, [], 'Every prepared plugin with valid host metadata must be discoverable locally.');
  assert(plugins.every(p => p.config.disabled), 'Unreviewed plugins must not start enabled.');
  assert(names.has('insomnia-plugin-crypto'), 'Crypto Plugin must be present.');
  const networkBlocked = await page.evaluate(async () => {
    try {
      const response = await fetch('https://offline-egress-test.invalid/');
      return response.status === 403;
    } catch {
      return true;
    }
  });
  assert(networkBlocked, 'Browser network policy should reject an unapproved external origin.');
  report.discoveredPlugins = plugins.length;
  report.defaultDisabled = true;
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error?.stack || error);
  throw error;
} finally {
  await writeFile('offline-smoke-report.json', JSON.stringify(report, null, 2));
  await app?.close().catch(() => {});
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
