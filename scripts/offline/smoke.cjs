// Packaged-app smoke check: no login, local CRUD, bundled tags, and the native HTTP transport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { _electron: electron } = require('@playwright/test');

async function main() {
  const out = path.resolve('offline-test-results');
  fs.mkdirSync(out, { recursive: true });
  const dist = path.resolve('packages/insomnia/dist-offline');
  const folder = fs.readdirSync(dist).find(name => name.endsWith('unpacked'));
  assert(folder, 'Missing unpacked application');
  const root = path.join(dist, folder);
  const exe = process.platform === 'win32'
    ? path.join(root, fs.readdirSync(root).find(name => name.endsWith('.exe')))
    : path.join(root, 'insomnia-offline');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnia-offline-smoke-'));
  const netlog = path.join(out, 'electron-netlog.json');
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"offlineNativeTransport":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/offline-smoke`;
  let app;
  let page;
  const consoleErrors = [];
  try {
    app = await electron.launch({
      executablePath: exe,
      args: [`--log-net-log=${netlog}`],
      env: { ...process.env, INSOMNIA_DATA_PATH: data, INSOMNIA_SESSION: '{"id":"must-be-ignored","accountId":"must-be-ignored"}' },
      timeout: 90000,
    });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      for (const candidate of app.windows()) {
        if (await candidate.locator('[data-testid="offline-mode"]').count().catch(() => 0)) { page = candidate; break; }
      }
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(page, 'The account-free offline UI did not appear');
    page.on('pageerror', error => consoleErrors.push(error.message));
    const initial = await page.evaluate(async () => {
      const call = (service, method, ...args) => window._dataServicesInvoke
        ? window._dataServicesInvoke(service, method, ...args)
        : window._dataServices[service][method](...args);
      return { user: await call('userSession', 'get'), settings: await call('settings', 'get'), plugins: await window.main.plugins.getBundlePlugins(), tags: await window.main.plugins.getTemplateTags() };
    });
    assert.equal(initial.user.id, '', 'A cloud identity was restored');
    assert.equal(initial.settings.enableAnalytics, false);
    assert.equal(initial.settings.updateAutomatically, false);
    assert(initial.plugins.some(plugin => plugin.name === 'insomnia-plugin-offline-toolkit'));
    const tags = initial.tags.filter(tag => tag.plugin.name === 'insomnia-plugin-offline-toolkit');
    assert.equal(tags.length, 12, 'Not all offline tools were bundled');
    // Exercise the authenticated templating bridge used by real template rendering.
    const cryptoResults = await page.evaluate(async () => {
      const token = await window.main.templatingDb.getAuthToken();
      const bridge = async (name, body) => {
        const response = await fetch('insomnia-templating-worker-database://' + name, {
          method: 'POST', headers: { 'x-insomnia-templating-auth': token }, body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error || 'Template bridge failed');
        return result;
      };
      const discovered = await bridge('plugin.getBundlePluginTemplateTags', {});
      const run = (tagName, args) => bridge('plugin.executeBundlePluginTag', {
        pluginName: 'insomnia-plugin-offline-toolkit', tagName, args,
        context: { meta: {}, context: {}, renderPurpose: 'preview' },
      });
      const hash = await run('offlineHash', ['abc', 'sha256']);
      const key = 'ab'.repeat(32);
      const envelope = await run('offlineAesEncrypt', ['offline packaged crypto', key]);
      const decrypted = await run('offlineAesDecrypt', [envelope, key]);
      return { hash, decrypted, tagCount: discovered.filter(tag => tag.plugin.name === 'insomnia-plugin-offline-toolkit').length };
    });
    assert.equal(cryptoResults.tagCount, 12, 'Template rendering cannot discover all offline tags');
    assert.equal(cryptoResults.hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(cryptoResults.decrypted, 'offline packaged crypto');
    // Exercise the actual React Router create action, not only the database service.
    await page.getByRole('button', { name: 'Create new Project' }).click();
    await page.getByPlaceholder('My Project').fill('Offline UI Smoke Project');
    await page.getByRole('dialog').getByText('Local Vault', { exact: true }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForFunction(async () => {
      const projects = window._dataServicesInvoke
        ? await window._dataServicesInvoke('project', 'listByOrganizationIds', 'org_offline')
        : await window._dataServices.project.listByOrganizationIds('org_offline');
      return projects.some(project => project.name === 'Offline UI Smoke Project');
    }, null, { timeout: 30000 });
    const result = await page.evaluate(async url => {
      const call = (service, method, ...args) => window._dataServicesInvoke
        ? window._dataServicesInvoke(service, method, ...args)
        : window._dataServices[service][method](...args);
      const projects = await call('project', 'listByOrganizationIds', 'org_offline');
      const project = projects.find(project => project.name === 'Offline UI Smoke Project');
      const workspace = await call('workspace', 'create', { parentId: project._id, name: 'Offline native test', scope: 'collection' });
      const request = await call('request', 'create', { parentId: workspace._id, name: 'Native HTTP test', url, method: 'GET' });
      const settings = await call('settings', 'get');
      const response = await window.main.curlRequest({ requestId: request._id, req: { ...request, cookieJar: {}, cookies: [], suppressUserAgent: false }, finalUrl: url, settings, certificates: [], caCertficatePath: null });
      return { projectId: project._id, workspaceId: workspace._id, response: response.patch };
    }, url);
    assert.equal(result.response.statusCode, 200, JSON.stringify(result.response));
    await page.screenshot({ path: path.join(out, 'offline-smoke.png') });
    await new Promise(resolve => setTimeout(resolve, 3000));
    await app.close(); app = null;
    const events = JSON.parse(fs.readFileSync(netlog, 'utf8')).events || [];
    const vendor = /(?:insomnia\.(?:rest|plus)|konghq\.com|segment\.(?:io|com)|sentry\.io|customer(?:io)?\.(?:io|com)|gist\.build)/i;
    const attemptedVendorRequests = events.filter(event => typeof event.params?.url === 'string' && vendor.test(event.params.url));
    assert.equal(attemptedVendorRequests.length, 0, 'Startup attempted to contact vendor services');
    assert.deepEqual(consoleErrors, [], 'Renderer errors occurred');
    fs.writeFileSync(path.join(out, 'smoke.json'), JSON.stringify({ passed: true, platform: process.platform, arch: process.arch, localProjectCreatedThroughUI: true, templateBridgeCryptoVerified: true, nativeHttpStatus: result.response.statusCode, bundledOfflineTags: tags.map(tag => tag.templateTag.name), attemptedVendorRequests: 0, limitations: 'Electron netlog is not a complete OS-level egress capture; no full air-gap certification is implied.' }, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
