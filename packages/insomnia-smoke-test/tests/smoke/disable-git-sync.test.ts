import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// The vendor's billing/storage flags must not disable user-owned local Git in
// this offline fork. No vendor session or remote repository is needed here.
test.describe('Offline Git capability does not depend on vendor flags', () => {
  test.afterEach(async ({ request }) => {
    await request.post('http://127.0.0.1:4010/v1/test-utils/organizations/features', {
      data: { features: { gitSync: { enabled: true } } },
    });
    await request.post('http://127.0.0.1:4010/v1/test-utils/organizations/storage-rule', {
      data: { enableCloudSync: true, enableGitSync: true, enableLocalVault: true, isOverridden: false },
    });
  });

  test('local Git is available even when the test vendor reports an unpaid feature', async ({ page, request }) => {
    await request.post('http://127.0.0.1:4010/v1/test-utils/organizations/features', {
      data: { features: { gitSync: { enabled: false } } },
    });
    await page.getByRole('button', { name: 'Create new Project' }).click();
    await expect.soft(page.getByLabel('Project Type: git', { exact: true })).toBeEnabled();
    await expect.soft(page.getByLabel('Project Type: remote', { exact: true })).toBeDisabled();
    await page.getByLabel('Project Type Item: git', { exact: true }).click();
    await expect.soft(page.getByLabel('Git Setup Form')).toBeVisible();
    await expect.soft(page.getByLabel('Git Sync Feature Disabled Banner')).toBeHidden();
    const session = await page.evaluate(() => window._dataServicesInvoke('userSession', 'get'));
    expect.soft(session.id).toBe('');
  });

  test('vendor storage rules neither enable cloud nor disable local Git', async ({ page, request }) => {
    await request.post('http://127.0.0.1:4010/v1/test-utils/organizations/storage-rule', {
      data: { enableCloudSync: true, enableGitSync: false, enableLocalVault: false, isOverridden: true },
    });
    await page.getByRole('button', { name: 'Create new Project' }).click();
    await expect.soft(page.getByLabel('Project Type: local', { exact: true })).toBeEnabled();
    await expect.soft(page.getByLabel('Project Type: git', { exact: true })).toBeEnabled();
    await expect.soft(page.getByLabel('Project Type: remote', { exact: true })).toBeDisabled();
  });
});
