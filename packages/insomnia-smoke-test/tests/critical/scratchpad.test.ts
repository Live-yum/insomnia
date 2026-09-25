import { expect } from '@playwright/test';

import { createOfflineTestProject } from '../../playwright/offline-project';
import { test } from '../../playwright/test';

test('local projects and request collections are available without a vendor account', async ({ app, page }) => {
  const project = await createOfflineTestProject(app, page, 'Account-free workspace');
  // The empty-project dashboard has a dedicated collection selector; the
  // nonempty-project toolbar is intentionally absent until a file exists.
  await page.getByRole('button', { name: 'Select target API collection', exact: true }).click();
  await page.getByRole('button', { name: 'New API Collection', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Enter a name for your API Collection') });
  await dialog.getByPlaceholder('Enter a name for your API Collection').fill('Offline request collection');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.soft(dialog).toBeHidden();
  await expect.soft(page.getByTestId('offline-mode')).toBeVisible();
  await expect.soft(page.getByRole('grid', { name: 'Files', exact: true })).toContainText('Offline request collection');
  await expect.soft(page.getByText('Unlock full features', { exact: true })).toHaveCount(0);
  const result = await page.evaluate(async () => ({
    session: await window._dataServicesInvoke('userSession', 'get'),
    workspaces: await window._dataServicesInvoke('workspace', 'list'),
  }));
  expect.soft(result.session.id).toBeFalsy();
  expect.soft(result.session.accountId).toBeFalsy();
  const collection = result.workspaces.find(workspace => workspace.name === 'Offline request collection');
  expect.soft(collection?.parentId).toBe(project?._id);
  expect.soft(collection?.scope).toBe('collection');
});
