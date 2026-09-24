import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { _electron as electron } from 'playwright';

const executablePath = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/offline/smoke.mjs <packaged-executable>');
const directory = path.dirname(executablePath);
const catalog = JSON.parse(await readFile(path.join(directory, 'resources/offline-plugins/catalog.json'), 'utf8'));
const expected = catalog.entries.filter(e => e.status === 'materialized-unreviewed').map(e => e.name);
assert(expected.length > 50, 'A full catalog, not a selected handful of plugins, must be packaged.');
const profile = await mkdtemp(path.join(os.tmpdir(), 'insomnia-offline-smoke-'));
const env = { ...process.env, INSOMNIA_OFFLINE_DATA_PATH: profile };
for (const key of ['INSOMNIA_DATA_PATH', 'INSOMNIA_SESSION', 'INSOMNIA_OFFLINE_BROWSER_ORIGINS', 'INSOMNIA_OFFLINE_PLUGIN_DIR', 'GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN']) delete env[key];
let app;
const report = { sourceCommit: process.env.GITHUB_SHA, expectedPlugins: expected.length, passed: false,
  scope: 'Packaged startup, account-free local route, disabled-plugin enumeration and Chromium URL policy; not an OS-level egress audit.' };
try {
  app = await electron.launch({ executablePath, env, timeout: 120_000 });
  const page = await app.firstWindow({ timeout: 120_000 });
  page.setDefaultTimeout(120_000);
  await page.waitForURL(url => url.pathname.startsWith('/organization/org_offline/'));
  await page.getByTestId('offline-mode').waitFor({ state: 'visible' });
  const plugins = await page.evaluate(() => window.main.plugins.getPlugins());
  const names = new Set(plugins.map(p => p.name));
  const missing = expected.filter(name => !names.has(name));
  assert.deepEqual(missing, [], 'Every successfully materialized catalog plugin must be discoverable locally.');
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
