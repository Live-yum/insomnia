import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test('local vault unlocks with its actual key after locking and reloading without a vendor account', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  await page.getByRole('button', { name: 'Generate Vault Key' }).click();
  const display = page.getByTestId('VaultKeyDisplayPanel');
  await expect.soft(display).not.toHaveText('');
  const key = await display.innerText();
  await page.getByRole('button', { name: 'Lock Vault', exact: true }).click();
  await expect.soft(page.getByRole('button', { name: 'Enter Vault Key' })).toBeVisible();
  await page.reload();
  await page.getByTestId('offline-mode').waitFor({ state: 'visible' });
  await page.getByTestId('settings-button').click();
  await page.getByRole('button', { name: 'Enter Vault Key' }).click();
  const modal = page.getByTestId('input-vault-key-modal');
  await modal.getByLabel('Vault Key Input').fill(key);
  await modal.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect.soft(modal).toBeHidden();
  await expect.soft(page.getByTestId('VaultKeyDisplayPanel')).toHaveText(key);
  const session = await page.evaluate(() => window._dataServicesInvoke('userSession', 'get'));
  expect.soft(session.id).toBe('');
  expect.soft(session.accountId).toBe('');
  expect.soft(session.vaultKey).not.toBe(key);
  expect.soft(session.offlineVaultProof).toBeTruthy();
});
