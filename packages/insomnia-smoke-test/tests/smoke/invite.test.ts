import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// Invitations require the deliberately absent vendor service. Verify this
// boundary rather than simulating cloud login in an account-free local build.
test('local workspaces do not offer cloud invitations or acquire a vendor session', async ({ page, insomnia }) => {
  await expect(page.getByTestId('offline-mode')).toBeVisible();
  await expect(page.getByLabel('Invite collaborators')).toHaveCount(0);
  await expect(page.getByPlaceholder('Enter emails, separated by')).toHaveCount(0);
  await insomnia.projectPage.createProject('Private offline project');
  const before = await page.evaluate(() => window._dataServicesInvoke('project', 'list'));
  await page.reload();
  await expect(page.getByTestId('offline-mode')).toBeVisible();
  await expect(page.getByLabel('Invite collaborators')).toHaveCount(0);
  const state = await page.evaluate(async () => ({
    session: await window._dataServicesInvoke('userSession', 'get'),
    projects: await window._dataServicesInvoke('project', 'list'),
  }));
  expect(state.session.id).toBe('');
  expect(state.session.accountId).toBe('');
  expect(state.projects.map(project => project._id).sort()).toEqual(before.map(project => project._id).sort());
  expect(state.projects.find(project => project.name === 'Private offline project')).toMatchObject({
    parentId: 'org_offline', remoteId: null,
  });
});
