import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { _electron as electron } from 'playwright';

if (!process.argv[2]) throw new Error('Usage: node scripts/offline/smoke.mjs <packaged-executable>');
const executablePath = path.resolve(process.argv[2]);
const directory = path.dirname(executablePath);
const resourceRoot = path.join(directory, 'resources/offline-plugins');
const catalog = JSON.parse(await readFile(path.join(resourceRoot, 'catalog.json'), 'utf8'));
const manifest = JSON.parse(await readFile('vendor/offline-plugins/manifest.json', 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert(/^[0-9a-f]{40}$/.test(sourceCommit), 'Record the checked-out source, not the caller workflow commit.');
assert.equal(catalog.sourceSha256, manifest.sourceSha256, 'Packaged catalog must match the reviewed source snapshot.');
assert.deepEqual(
  catalog.entries.map(entry => entry.name).sort(),
  manifest.entries.map(entry => entry.name).sort(),
  'Every entry in the exact catalog must be accounted for; a selected subset must fail.',
);
const sourceByName = new Map(manifest.entries.map(entry => [entry.name, entry]));
const materializationFailures = catalog.entries.filter(entry =>
  sourceByName.get(entry.name).status === 'dependency-complete-unreviewed' && entry.status !== 'materialized-unreviewed',
);
assert.deepEqual(materializationFailures, [], 'Do not silently omit complete plugins after an extraction failure.');
const prepared = catalog.entries.filter(entry => entry.status === 'materialized-unreviewed');
const expected = [];
const incompatibleManifests = [];
for (const entry of prepared) {
  assert(/^[0-9a-f]{20}$/.test(entry.profile));
  assert(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(entry.name));
  const pluginManifest = JSON.parse(await readFile(path.join(resourceRoot, entry.profile, 'node_modules', entry.name, 'package.json'), 'utf8'));
  assert.equal(pluginManifest.name, entry.name, 'Packaged plugin identity must match the catalog.');
  assert.equal(pluginManifest.version, entry.version, 'Packaged plugin version must match the catalog.');
  if (!pluginManifest.insomnia || typeof pluginManifest.insomnia !== 'object') {
    incompatibleManifests.push({ name: entry.name, reason: 'Missing required insomnia plugin metadata' });
  } else {
    expected.push(entry.name);
  }
}
const executableHash = createHash('sha256');
for await (const chunk of createReadStream(executablePath)) executableHash.update(chunk);
const profile = await mkdtemp(path.join(os.tmpdir(), 'insomnia-offline-smoke-'));
const env = { ...process.env, INSOMNIA_OFFLINE_DATA_PATH: profile };
for (const key of [
  'INSOMNIA_DATA_PATH', 'INSOMNIA_SESSION', 'INSOMNIA_SKIP_ONBOARDING', 'PLAYWRIGHT_TEST',
  'INSOMNIA_OFFLINE_BROWSER_ORIGINS', 'INSOMNIA_OFFLINE_PLUGIN_DIR', 'ELECTRON_RUN_AS_NODE',
  'GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN',
]) delete env[key];
let app;
let probeRequests = 0;
const probe = createServer((_request, response) => {
  probeRequests += 1;
  response.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  response.end('reachable-loopback-control');
});
const report = {
  sourceCommit,
  target: catalog.target,
  catalogEntries: catalog.entries.length,
  materializedPlugins: prepared.length,
  expectedPlugins: expected.length,
  electronImageSha256: executableHash.digest('hex'),
  incompatibleManifests,
  archiveExceptions: catalog.entries.filter(entry => entry.status !== 'materialized-unreviewed').map(entry => ({ name: entry.name, status: entry.status, error: entry.error })),
  passed: false,
  allCatalogPluginsUsable: false,
  scope: 'Packaged startup, real local route, disabled-plugin enumeration, renderer isolation and Chromium URL policy. Windows UI is tested before wrapping; the final secure wrapper has a separate normal-start test on identical Electron bytes. Not all plugin functionality or site egress certification.',
};
try {
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const probeUrl = `http://127.0.0.1:${probe.address().port}/offline-policy-control`;
  const control = await fetch(probeUrl, { signal: AbortSignal.timeout(10_000) });
  assert.equal(await control.text(), 'reachable-loopback-control');
  assert.equal(probeRequests, 1, 'Positive control must reach the live server.');
  probeRequests = 0;
  // Playwright 1.59 defaults this to false; testing with that default silently
  // adds --no-sandbox. Explicit true is mandatory for this distribution.
  app = await electron.launch({ executablePath, env, chromiumSandbox: true, timeout: 120_000 });
  const page = await app.firstWindow({ timeout: 120_000 });
  page.setDefaultTimeout(120_000);
  await page.waitForURL(url => url.pathname.startsWith('/organization/org_offline/'));
  await page.getByTestId('offline-mode').waitFor({ state: 'visible' });
  const security = await app.evaluate(({ app: application, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('/organization/org_offline/'));
    if (!window) throw new Error('No real local-organization window');
    const preferences = window.webContents.getLastWebPreferences();
    return {
      noSandboxArgument: application.commandLine.hasSwitch('no-sandbox'),
      nodeIntegration: preferences.nodeIntegration,
      nodeIntegrationInWorker: preferences.nodeIntegrationInWorker,
      contextIsolation: preferences.contextIsolation,
      sandbox: preferences.sandbox,
    };
  });
  assert.equal(security.noSandboxArgument, false, 'The tested executable must not have --no-sandbox.');
  assert.equal(security.nodeIntegration, false);
  assert.equal(security.nodeIntegrationInWorker, false);
  assert.equal(security.contextIsolation, true);
  assert.equal(security.sandbox, true);
  report.rendererSecurity = security;
  report.chromiumSandboxEnabled = true;
  const plugins = await page.evaluate(() => window.main.plugins.getPlugins());
  const names = new Set(plugins.map(plugin => plugin.name));
  const missing = expected.filter(name => !names.has(name));
  assert.deepEqual(missing, [], 'Every prepared plugin with valid host metadata must be discoverable locally.');
  assert(plugins.every(plugin => plugin.config.disabled), 'Unreviewed plugins must not start enabled.');
  assert(names.has('insomnia-plugin-crypto'), 'Crypto Plugin must be present.');
  const chromiumResult = await app.evaluate(async ({ net }, url) => {
    try {
      const response = await net.fetch(url, { bypassCustomProtocolHandlers: true, signal: AbortSignal.timeout(10_000) });
      return { status: response.status, error: null };
    } catch (error) {
      return { status: null, error: String(error) };
    }
  }, probeUrl);
  assert.equal(probeRequests, 0, 'A blocked Chromium request must never arrive at the reachable server.');
  assert(chromiumResult.error || chromiumResult.status === 403, 'Chromium must reject the unapproved origin.');
  report.discoveredPlugins = plugins.length;
  report.defaultDisabled = true;
  report.liveLoopbackControlPassed = true;
  report.chromiumProbe = chromiumResult;
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error?.stack || error);
  if (app) console.error('Application windows:', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ title: window.getTitle(), url: window.webContents.getURL() }))).catch(() => []));
  throw error;
} finally {
  await writeFile('offline-smoke-report.json', JSON.stringify(report, null, 2));
  await app?.close().catch(() => {});
  probe.closeAllConnections();
  if (probe.listening) await new Promise(resolve => probe.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
