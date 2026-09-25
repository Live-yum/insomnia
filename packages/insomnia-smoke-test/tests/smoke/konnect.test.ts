import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

test.describe('Offline control-plane boundary', () => {
  test('opens local projects without offering Konnect configuration or cloud sync', async ({ page }) => {
    await expect(page.getByTestId('offline-mode')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create new Project' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Organizations' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sync Konnect' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Konnect settings' })).toHaveCount(0);
    await expect(page.getByLabel('Personal Access Token', { exact: true })).toHaveCount(0);
    const session = await page.evaluate(() => window._dataServicesInvoke('userSession', 'get'));
    expect(session.id).toBe('');
    expect(session.accountId).toBe('');
  });

  test('vendor entitlements do not change the offline organization or connect control planes', async ({ page, request }) => {
    const projects = await page.evaluate(() => window._dataServicesInvoke('project', 'list'));
    await request.post('http://127.0.0.1:4010/v1/test-utils/user/entitlements', { data: { entitlements: [] } });
    try {
      await page.reload();
      await expect(page.getByTestId('offline-mode')).toBeVisible();
      await expect(page.getByRole('option', { name: 'Control Planes' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Connect & Sync' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Create new Project' })).toBeVisible();
      const after = await page.evaluate(() => window._dataServicesInvoke('project', 'list'));
      expect(after.map(project => project._id).sort()).toEqual(projects.map(project => project._id).sort());
    } finally {
      await request.post('http://127.0.0.1:4010/v1/test-utils/user/entitlements', { data: {} });
    }
  });
});
