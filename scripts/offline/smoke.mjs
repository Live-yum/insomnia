import assert from 'node:assert/strict';
import { verifyCompleteSmoke } from './verify-complete-smoke.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

const executablePath = process.env.INSOMNIA_OFFLINE_SMOKE_EXE;
if (!executablePath) throw new Error('Set INSOMNIA_OFFLINE_SMOKE_EXE to the packaged binary');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'insomnia-offline-smoke-'));
const env = { ...process.env, NODE_ENV: 'production', INSOMNIA_OFFLINE_DATA_PATH: profile };
delete env.INSOMNIA_DATA_PATH;
delete env.INSOMNIA_SESSION;
delete env.INSOMNIA_OFFLINE_PLUGIN_DIR;
for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN']) delete env[key];
delete env.INSOMNIA_OFFLINE_BROWSER_ORIGINS;
const app = await electron.launch({ executablePath: path.resolve(executablePath), env, timeout: 60000 });
let page;
try {
  page = await app.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(30000);
  await page.getByTestId('offline-mode').waitFor();
  assert.match(page.url(), /organization\/org_offline\/project/);
  const initial = await page.evaluate(async () => ({
    session: await window._dataServicesInvoke('userSession', 'get'),
    plugins: await window.main.plugins.getBundlePlugins(),
    updateStatus: window.main.getUpdateStatus(),
  }));
  assert.ok(!initial.session.id && !initial.session.accountId);
  assert.equal(initial.updateStatus, 'idle');
  assert.deepEqual(initial.plugins.map(p => p.name).sort(), ['insomnia-plugin-crypto', 'insomnia-plugin-offline-crypto-tools']);
  await page.getByRole('button', { name: 'Create new Project', exact: true }).click();
  // The empty-state page also has a form. Use the active dialog and visible
  // React Aria label; its hidden radio input is intentionally covered by the label.
  const dialog = page.getByRole('dialog', { name: 'Create or update dialog', exact: true });
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('Offline smoke project');
  await dialog.locator('[aria-label="Project Type Item: local"]').click();
  await dialog.getByRole('button', { name: 'Project type: Local Vault. Change', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForURL(/\/organization\/org_offline\/project\/[^/]+/);
  const projectUrl = page.url();
  const projects = await page.evaluate(() => window._dataServicesInvoke('project', 'list'));
  const project = projects.find(p => p.name === 'Offline smoke project');
  assert.ok(project && project.parentId === 'org_offline' && !project.remoteId && !project.gitRepositoryId);

  // Exercise the packaged app's authenticated template execution bridge, not a direct require of the plugin.
  const hmac = await page.evaluate(async () => {
    const token = await window.main.templatingDb.getAuthToken();
    const response = await fetch('insomnia-templating-worker-database://plugin.executeBundlePluginTag', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-insomnia-templating-auth': token },
      body: JSON.stringify({ pluginName: 'insomnia-plugin-offline-crypto-tools', tagName: 'offlineHmac', args: ['sha256', 'Hi There', '\u000b'.repeat(20), 'hex'], context: { meta: {}, context: {}, renderPurpose: 'send' } }),
    });
    if (!response.ok) throw new Error('Bundled template bridge failed: ' + await response.text());
    return response.json();
  });
  assert.equal(hmac, 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  const blocked = await page.evaluate(async () => {
    try {
      const response = await fetch('https://api.insomnia.rest/v1/user');
      return response.status === 403;
    } catch { return true; }
  });
  assert.equal(blocked, true);
  await page.evaluate(() => window.main.manualUpdateCheck());
  assert.equal(await page.evaluate(() => window.main.getUpdateStatus()), 'idle');
  await page.reload();
  await page.getByTestId('offline-mode').waitFor();
  assert.equal(page.url(), projectUrl);
  await verifyCompleteSmoke(app, page);
  console.log('Packaged offline smoke passed: clean profile, no login, local project UI, persisted route, bundled plugins, HMAC bridge, blocked vendor fetch, disabled updates.');
} catch (error) {
  await fs.mkdir('offline-test-results', { recursive: true });
  await fs.writeFile('offline-test-results/error.txt', String(error?.stack || error));
  if (page) {
    await page.screenshot({ path: 'offline-test-results/failure.png' }).catch(() => {});
    await fs.writeFile('offline-test-results/page.txt', await page.content()).catch(() => {});
  }
  throw error;
} finally {
  await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
