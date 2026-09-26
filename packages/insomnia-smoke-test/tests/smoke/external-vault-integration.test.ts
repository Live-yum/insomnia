import { expect } from '@playwright/test';

import { getFixturePath, loadFixture } from '../../playwright/paths';
import { test } from '../../playwright/test';

// Downloaded cloud-provider code must not silently authenticate or resolve
// imported external-vault tags. Real local vault encryption is covered by
// insomnia-vault and offline-vault-roundtrip tests with an OS keyring.
test('importing external vault references preserves the request without cloud authentication', async ({ app, page, insomnia }) => {
  const text = (await loadFixture('template-tag-collection.yaml')).replace(
    '__TEMPLATE_TAG_FILE_PATH', getFixturePath('files/template-file.txt'),
  );
  await app.evaluate(({ clipboard }, contents) => clipboard.writeText(contents), text);
  await page.getByLabel('Import', { exact: true }).click();
  await page.locator('[data-test-id="import-from-clipboard"]').click();
  // Choosing Clipboard selects the source; Scan produces the import preview.
  // Exercise both user actions and wait for the actual import to finish.
  await page.getByRole('dialog').getByRole('button', { name: 'Scan' }).click();
  const preview = page.getByRole('dialog', { name: 'Modal', exact: true });
  await expect(preview.getByRole('cell', { name: '14 Requests', exact: true })).toBeVisible();
  // The visible icon contributes a prefix to the accessible button name.
  // Keep the confirmation scoped to its preview, without depending on its glyph.
  await preview.getByRole('button', { name: /\bImport$/ }).click();
  await preview.waitFor({ state: 'hidden' });
  await insomnia.navigationSidebar.clickRequestOrFolder('External Vault Tag');
  const before = await page.evaluate(() => window._dataServicesInvoke('request', 'all'));
  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Credentials', exact: true }).click();
  await expect.soft(page.getByRole('button', { name: 'Create Cloud Credential', exact: true })).toHaveCount(0);
  await expect.soft(page.getByText('Authenticate With Azure', { exact: true })).toHaveCount(0);
  const session = await page.evaluate(() => window._dataServicesInvoke('userSession', 'get'));
  expect.soft(session.id).toBe('');
  expect.soft(session.accountId).toBe('');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect.soft(page.getByTestId('offline-mode')).toBeVisible();
  const after = await page.evaluate(() => window._dataServicesInvoke('request', 'all'));
  const importedBefore = before.find(request => request.name === 'External Vault Tag');
  const importedAfter = after.find(request => request.name === 'External Vault Tag');
  expect.soft(importedBefore).toBeTruthy();
  expect.soft(importedAfter?.body).toEqual(importedBefore?.body);
  expect.soft(JSON.stringify(importedAfter?.body)).toContain("{% vault 'aws'");
  expect.soft(JSON.stringify(importedAfter?.body)).toContain("{% vault 'gcp'");
  expect.soft(JSON.stringify(importedAfter?.body)).toContain("{% vault 'hashicorp'");
});
