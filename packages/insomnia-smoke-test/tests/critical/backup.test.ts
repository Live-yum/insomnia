import fs from 'node:fs/promises';
import path from 'node:path';

import { expect } from '@playwright/test';

import { createOfflineTestProject } from '../../playwright/offline-project';
import { test } from '../../playwright/test';

test('disabled update checks preserve local project data across a real restart', async ({ app, page, insomnia }) => {
  const project = await createOfflineTestProject(app, page, 'Offline persistence');
  const dataPath = await app.evaluate(({ app }) => app.getPath('userData'));
  const projectUrl = page.url();
  const status = await page.evaluate(async () => {
    await window.main.manualUpdateCheck();
    return window.main.getUpdateStatus();
  });
  expect.soft(status).toBe('idle');

  // An offline build must not run update-triggered backup jobs. It must still
  // persist the user's real data; closing and reopening tests that independently.
  const directories = await fs.readdir(dataPath);
  expect.soft(directories).not.toContain('backups');
  const databaseFile = path.join(dataPath, 'insomnia.Project.db');
  expect.soft((await fs.stat(databaseFile)).size).toBeGreaterThan(0);
  await insomnia.relaunch();
  await expect.soft(insomnia.page.getByTestId('offline-mode')).toBeVisible();
  await expect.soft(insomnia.page).toHaveURL(projectUrl);
  const projects = await insomnia.page.evaluate(() => window._dataServicesInvoke('project', 'list'));
  expect.soft(projects.find(candidate => candidate._id === project?._id)).toEqual(project);
});
