import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Set up a real local project through the UI, without simulating a vendor login. */
export async function createOfflineTestProject(app: ElectronApplication, page: Page, name = 'Personal Workspace') {
  await expect(page.getByTestId('offline-mode')).toBeVisible();
  const dataPath = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(dataPath).toBeTruthy();
  const session = await page.evaluate(() => window._dataServicesInvoke('userSession', 'get'));
  expect(session.id).toBeFalsy();
  expect(session.accountId).toBeFalsy();

  await page.getByRole('button', { name: 'Create new Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create or update dialog', exact: true });
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
  await dialog.locator('[aria-label="Project Type Item: local"]').click();
  await expect(dialog.getByRole('button', { name: 'Project type: Local Vault. Change', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/organization\/org_offline\/project\/[^/]+$/);
  await expect(dialog).toBeHidden();
  const projects = await page.evaluate(() => window._dataServicesInvoke('project', 'list'));
  const project = projects.find(project => project.name === name);
  expect(project).toBeDefined();
  expect(project?.parentId).toBe('org_offline');
  expect(project?.remoteId).toBeFalsy();
  expect(project?.gitRepositoryId).toBeFalsy();
  return project;
}
