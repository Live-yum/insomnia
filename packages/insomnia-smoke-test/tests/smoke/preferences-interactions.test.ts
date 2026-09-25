import { expect } from '@playwright/test';

import { loadFixture } from '../../playwright/paths';
import { test } from '../../playwright/test';

test('Preferences through click', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  await page.getByTestId('preference-modal').waitFor({ state: 'visible' });
});

test('Preferences through keyboard shortcut', async ({ page }) => {
  await page.locator('.app').press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await page.getByTestId('preference-modal').waitFor({ state: 'visible' });
});

// AI cloud UI is intentionally disabled. Its local configuration store remains
// editable through the typed API, and must retain its data without contacting a model.
test('AI URL configuration persists locally while cloud UI stays disabled', async ({ page }) => {
  const expected = {
    url: 'https://llm.local/v1', model: 'gpt-4o-mini', apiKey: 'persisted-token',
    temperature: 0.7, topP: 0.95, maxTokens: 4096,
  };
  await page.evaluate(async config => {
    await window.main.llm.updateBackendConfig('url', config);
    await window.main.llm.setActiveBackend('url');
  }, expected);
  await page.reload();
  await page.getByTestId('offline-mode').waitFor({ state: 'visible' });
  await page.getByTestId('settings-button').click();
  await page.getByTestId('preference-modal').waitFor({ state: 'visible' });
  await expect.soft(page.getByRole('tab', { name: 'AI Settings' })).toHaveCount(0);
  const config = await page.evaluate(() => window.main.llm.getBackendConfig('url'));
  expect.soft(config).toMatchObject({ backend: 'url', ...expected });
  const session = await page.evaluate(() => window._dataServicesInvoke('userSession', 'get'));
  expect.soft(session.id).toBe('');
});

test('AI URL deactivation preserves the local configuration without enabling cloud UI', async ({ page }) => {
  const expected = {
    url: 'https://llm-deactivate.local/v1', model: 'gpt-4o-mini', apiKey: 'activation-token',
    temperature: 0.6, topP: 0.9, maxTokens: 8192,
  };
  await page.evaluate(async config => {
    await window.main.llm.updateBackendConfig('url', config);
    await window.main.llm.setActiveBackend('url');
  }, expected);
  expect.soft(await page.evaluate(() => window.main.llm.getActiveBackend())).toBe('url');
  await page.evaluate(() => window.main.llm.clearActiveBackend());
  await page.reload();
  await page.getByTestId('offline-mode').waitFor({ state: 'visible' });
  await page.getByTestId('settings-button').click();
  await expect.soft(page.getByRole('tab', { name: 'AI Settings' })).toHaveCount(0);
  const [activeBackend, config] = await page.evaluate(async () => [
    await window.main.llm.getActiveBackend(), await window.main.llm.getBackendConfig('url'),
  ] as const);
  expect.soft(activeBackend).toBeNull();
  expect.soft(config).toMatchObject({ backend: 'url', ...expected });
});

// Quick reproduction for Kong/insomnia#5664 and INS-2267
test('Check filter responses by environment preference', async ({ app, page, insomnia }) => {
  const text = await loadFixture('simple.yaml');
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);
  await page.getByLabel('Import').click();
  await page.locator('[data-test-id="import-from-clipboard"]').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  // Send a request
  await insomnia.navigationSidebar.clickRequestOrFolder('example http');
  await page.locator('[data-testid="request-pane"] button:has-text("Send")').click();
  await page.getByText("Console").click();
  await page.locator('text=HTTP/1.1 200 OK').click();

  // Set filter responses by environment
  await page.getByTestId('settings-button').click();
  await page.getByTestId('preference-modal').waitFor({ state: 'visible' });
  await page.locator('text=Filter responses by environment').click();
  await page.locator('.app').press('Escape');

  // Re-send the request and check timeline
  await page.locator('[data-testid="request-pane"] button:has-text("Send")').click();
  await page.getByText("Console").click();
  await page.locator('text=HTTP/1.1 200 OK').click();
});

test('Enable http and https proxies', async ({ app, page, insomnia }) => {
  const responsePane = page.getByTestId('response-pane');

  await page.getByTestId('settings-button').click();
  await page.getByTestId('preference-modal').waitFor({ state: 'visible' });
  await page.locator('[name="timeout"]').fill('1000');

  await page.getByRole('tab', { name: 'Proxy' }).click();
  await page.locator('text=Enable proxy').click();
  await page.locator('[name="httpProxy"]').fill('127.0.0.1:1111');
  await page.locator('[name="httpsProxy"]').fill('127.0.0.1:2222');
  await page.locator('[name="noProxy"]').fill('');
  await page.locator('.app').press('Escape');

  const text = await loadFixture('simple.yaml');
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);
  await page.getByLabel('Import').click();
  await page.locator('[data-test-id="import-from-clipboard"]').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();

  // send the request and check timeline
  await insomnia.navigationSidebar.clickRequestOrFolder('proxyEnabled');
  await page.locator('[data-testid="request-pane"] button:has-text("Send")').click();
  await page.getByText("Console").click();
  await expect.soft(responsePane).toContainText('Trying 127.0.0.1:1111'); // updated proxy
});
