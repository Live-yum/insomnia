import { expect } from '@playwright/test';

import { createOfflineTestProject } from '../../playwright/offline-project';
import { test } from '../../playwright/test';

test('local projects and request collections are available without a vendor account', async ({ app, page, insomnia }) => {
  await createOfflineTestProject(app, page, 'Account-free workspace');
  await insomnia.projectPage.createCollection('Offline request collection');
  await expect(page.getByTestId('offline-mode')).toBeVisible();
  await expect(page.getByText('Unlock full features', { exact: true })).toHaveCount(0);
  const session = await page.evaluate(() => window._dataServicesInvoke('userSession', 'get'));
  expect(session.id).toBeFalsy();
  expect(session.accountId).toBeFalsy();
});
