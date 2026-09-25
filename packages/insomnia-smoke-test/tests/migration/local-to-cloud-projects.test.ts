import fs from 'node:fs/promises';

import { expect } from '@playwright/test';

import { copyFixtureDatabase, getFixturePath } from '../../playwright/paths';
import { test } from '../../playwright/test';

const testWithLegacyDatabase = test.extend({
  dataPath: async ({ dataPath }, use) => {
    await copyFixtureDatabase('insomnia-legacy-db', dataPath);
    await use(dataPath);
  },
  userConfig: async ({ userConfig }, use) => {
    await use({ ...userConfig, session: undefined, skipOnboarding: false });
  },
});

// This is a migration test, not a simulated cloud login. Compare original
// fixture content against the live migrated data API and require no account.
testWithLegacyDatabase('migrates legacy local data without adopting or synchronizing cloud projects', async ({ page }) => {
  const requests = (await fs.readFile(getFixturePath('insomnia-legacy-db/insomnia.Request.db'), 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  const environments = (await fs.readFile(getFixturePath('insomnia-legacy-db/insomnia.Environment.db'), 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  const originalRequest = requests.find(request => request.name === 'Get list of rockets');
  const originalEnvironment = environments.find(environment => environment.name === 'Mars');
  expect.soft(originalRequest).toBeTruthy();
  expect.soft(originalEnvironment).toBeTruthy();

  // Legacy repositories have no fixture working tree. Use the same local IPC
  // operation as the required migration UI, then exercise the normal startup.
  await page.evaluate(() => window.main.git.runAllGitRepoMigrations());
  await page.reload();
  await expect.soft(page.getByTestId('offline-mode')).toBeVisible();
  await expect.soft(page.getByLabel('Continue with Google')).toHaveCount(0);
  const migrated = await page.evaluate(async ({ requestId, environmentId }) => ({
    project: await window._dataServicesInvoke('project', 'getById', 'proj_default-project'),
    cloud: await window._dataServicesInvoke('project', 'getById', 'proj_team_195a6ce0edb1427eb2e8ba7b986072e4'),
    request: await window._dataServicesInvoke('request', 'getById', requestId),
    environment: await window._dataServicesInvoke('environment', 'getById', environmentId),
    session: await window._dataServicesInvoke('userSession', 'get'),
  }), { requestId: originalRequest._id, environmentId: originalEnvironment._id });
  expect.soft(migrated.project).toMatchObject({ _id: 'proj_default-project', name: 'Insomnia', parentId: 'org_offline', remoteId: null });
  expect.soft(migrated.cloud).toMatchObject({ remoteId: 'team_195a6ce0edb1427eb2e8ba7b986072e4' });
  expect.soft(migrated.cloud?.parentId).not.toBe('org_offline');
  expect.soft(migrated.request).toMatchObject({ _id: originalRequest._id, name: originalRequest.name, method: originalRequest.method, url: originalRequest.url });
  expect.soft(migrated.environment?.data).toEqual(originalEnvironment.data);
  expect.soft(migrated.session.id).toBe('');
  expect.soft(migrated.session.accountId).toBe('');
});
