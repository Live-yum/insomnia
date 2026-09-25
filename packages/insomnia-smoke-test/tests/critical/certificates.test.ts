import path from 'node:path';

import { expect } from '@playwright/test';

import { createOfflineTestProject } from '../../playwright/offline-project';
import { getFixturePath, loadFixture } from '../../playwright/paths';
import { test } from '../../playwright/test';

test('can send request with custom ca root certificate', async ({ app, page, insomnia }) => {
  await createOfflineTestProject(app, page);
  const text = await loadFixture('smoke-test-collection.yaml');
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), text);

  await page.getByTestId('settings-button').click();
  await page.getByTestId('dataFolders').fill(getFixturePath(path.join('certificates', 'rootCA.pem')));
  await page.getByTestId('dataFolders-btn').click();
  await expect(page.getByText('rootCA.pem')).toBeVisible();
  await page.locator('.app').press('Escape');

  await page.getByLabel('Import').click();
  await page.locator('[data-test-id="import-from-clipboard"]').click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await insomnia.navigationSidebar.clickRequestOrFolder('sends request with certs');

  // The negative control must fail before trusting the test CA. Never disable TLS verification.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Error: SSL peer certificate or SSH remote key was not OK')).toBeVisible();
  const fixturePath = getFixturePath('certificates');
  await page.getByRole('button', { name: 'Add Certificates' }).click();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add CA Certificate' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(path.join(fixturePath, 'rootCA.pem'));
  await page.getByRole('button', { name: 'Done' }).click();

  // The positive control trusts only the supplied local CA.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('200 OK')).toBeVisible();
  await expect(page.locator('pre').filter({ hasText: '"id": "1"' })).toBeVisible();
});
