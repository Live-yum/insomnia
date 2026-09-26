import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

/** Called only after the common clean-profile/project/crypto acceptance checks. */
export async function verifyBasicSmoke(app, page) {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const runtime = await app.evaluate(() => ({ resources: process.resourcesPath, platform: process.platform, arch: process.arch }));
  const target = runtime.platform === 'win32' ? 'win32-x64' : 'linux-arm64';
  assert.equal(runtime.arch, runtime.platform === 'win32' ? 'x64' : 'arm64');
  for (const folder of ['offline-plugins', 'offline-plugin-resources', 'offline-reviewed-sources']) {
    await assert.rejects(fs.stat(path.join(runtime.resources, folder)), { code: 'ENOENT' });
  }
  const inventory = await page.evaluate(async () => ({
    all: await window.main.plugins.getPlugins(),
    active: await window.main.plugins.getActivePlugins(),
  }));
  const bundled = ['insomnia-plugin-crypto', 'insomnia-plugin-offline-crypto-tools'];
  assert.deepEqual(inventory.all.map(plugin => plugin.name).sort(), bundled);
  assert.deepEqual(inventory.active.map(plugin => plugin.name).sort(), bundled);
  assert.ok(inventory.all.every(plugin => !plugin.directory && !plugin.loadError));
  const marker = 'basic-offline-api-' + sourceCommit.slice(0, 12);
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
    assert.equal(await app.evaluate(async ({ net }, address) => {
      try { await net.fetch(address); return false; } catch { return true; }
    }, url), true);
    assert.equal(requests, before, 'Chromium reached the blocked control endpoint');
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
  const report = {
    status: 'passed', edition: 'basic', sourceCommit, target,
    platform: runtime.platform, arch: runtime.arch,
    reviewedBundledPlugins: bundled, communityPlugins: 0,
    cleanProfileNoLogin: true, localProjectPersistence: true, authenticatedHmacBridge: true,
    browserReachableControlBlocked: true, realNativeLoopbackApiPassed: true,
    noCommunityPluginPayload: true,
    completeCryptoMatrixVerified: false, completeChineseUiVerified: false,
    siteSecurityCertification: false,
  };
  await fs.mkdir('offline-test-results', { recursive: true });
  await fs.writeFile('offline-test-results/basic-smoke.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
