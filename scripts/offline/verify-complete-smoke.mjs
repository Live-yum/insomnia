import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Runs only after the existing clean-profile UI/project/crypto bridge smoke. */
export async function verifyCompleteSmoke(app, page) {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const runtime = await app.evaluate(() => ({ resources: process.resourcesPath, platform: process.platform, arch: process.arch }));
  const target = runtime.platform === 'win32' ? 'win32-x64' : 'linux-arm64';
  assert.equal(runtime.arch, runtime.platform === 'win32' ? 'x64' : 'arm64');
  const root = path.join(runtime.resources, 'offline-plugins');
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'catalog.json'), 'utf8'));
  const original = JSON.parse(await fs.readFile('vendor/offline-plugins/manifest.json', 'utf8'));
  const integrity = JSON.parse(await fs.readFile('offline-resource-integrity.json', 'utf8'));
  assert.equal(catalog.target, target);
  assert.equal(catalog.sourceSha256, original.sourceSha256);
  assert.equal(integrity.sourceCommit, sourceCommit);
  assert.equal(integrity.target, target);
  assert.equal(integrity.allSourceFilesPreserved, true);
  assert.deepEqual(catalog.entries.map(e => e.name).sort(), original.entries.map(e => e.name).sort());
  const bundled = new Set(['insomnia-plugin-crypto', 'insomnia-plugin-offline-crypto-tools']);
  const expected = [];
  const metadataExceptions = [];
  for (const entry of catalog.entries) {
    const upstream = original.entries.find(e => e.name === entry.name);
    if (upstream.status !== 'dependency-complete-unreviewed') continue;
    assert.equal(entry.status, 'materialized-unreviewed', `${entry.name}: ${entry.error}`);
    assert.match(entry.profile, /^[a-f0-9]{20}$/);
    const directory = path.join(root, entry.profile, 'node_modules', entry.name);
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    assert.equal(metadata.name, entry.name);
    assert.equal(metadata.version, entry.version);
    if (!metadata.insomnia) metadataExceptions.push(entry.name);
    else if (!bundled.has(entry.name)) expected.push({ name: entry.name, directory });
  }
  const plugins = await page.evaluate(() => window.main.plugins.getPlugins());
  for (const wanted of expected) {
    const found = plugins.find(p => p.name === wanted.name && path.resolve(p.directory) === path.resolve(wanted.directory));
    assert.ok(found, `Packaged catalog plugin missing from loader: ${wanted.name}`);
    assert.equal(found.config.disabled, true, `Unreviewed plugin enabled: ${wanted.name}`);
    assert.ok(!found.loadError, `${wanted.name}: ${found.loadError}`);
  }
  const active = await page.evaluate(() => window.main.plugins.getActivePlugins());
  assert.deepEqual(active.map(p => p.name).sort(), [...bundled].sort());
  // A real reachable loopback service distinguishes browser-policy denial from
  // missing DNS, and verifies the user's native API transport remains usable.
  const marker = 'offline-api-transport-' + sourceCommit.slice(0, 12);
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests++;
    response.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    response.end(marker);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/offline-check`;
  try {
    assert.equal(await (await fetch(url)).text(), marker);
    const before = requests;
    const browserBlocked = await app.evaluate(async ({ net }, address) => {
      try { await net.fetch(address); return false; } catch { return true; }
    }, url);
    assert.equal(browserBlocked, true, 'Chromium unexpectedly bypassed the default offline origin policy');
    assert.equal(requests, before, 'Chromium reached the loopback control server');
    const result = await page.evaluate(async address => {
      const token = await window.main.templatingDb.getAuthToken();
      const response = await fetch('insomnia-templating-worker-database://network.sendRequestWithoutSideEffects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-insomnia-templating-auth': token },
        body: JSON.stringify({ options: { request: { url: address, method: 'GET', headers: [] } } }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }, url);
    assert.equal(result.code, 200);
    assert.equal(result.body, marker);
    assert.equal(requests, before + 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await fs.mkdir('offline-test-results', { recursive: true });
  const report = {
    status: 'passed', sourceCommit, target, platform: runtime.platform, arch: runtime.arch,
    catalogEntries: catalog.entries.length,
    materializedPlugins: catalog.entries.filter(e => e.status === 'materialized-unreviewed').length,
    discoverableCommunityPlugins: expected.length, metadataExceptions,
    snapshotExceptions: catalog.entries.filter(e => e.status !== 'materialized-unreviewed').map(e => ({ name: e.name, status: e.status, error: e.error })),
    reviewedBundledPlugins: [...bundled],
    originalCryptoArchiveSupersededByReviewedBundle: true,
    cleanProfileNoLogin: true, localProjectPersistence: true, authenticatedHmacBridge: true,
    browserReachableControlBlocked: true, realNativeLoopbackApiPassed: true,
    unreviewedEntrypointsNotEvaluated: true,
    resourceTreeSha256: integrity.treeSha256,
    catalogSha256: createHash('sha256').update(await fs.readFile(path.join(root, 'catalog.json'))).digest('hex'),
    allCommunityPluginFunctionsVerified: false, siteSecurityCertification: false,
  };
  await fs.writeFile('offline-test-results/complete-smoke.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
