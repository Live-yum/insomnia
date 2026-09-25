import { expect } from '@playwright/test';

import { test } from '../../playwright/test';

// This fork intentionally has no vendor cloud service. Exercise the real IPC
// rejection paths instead of simulating a vendor login or skipping the suite.
// Local version history remains supported and is tested independently below.
test.describe('Offline cloud boundary and local version history', () => {
  test('cloud storage is disabled while local storage remains available without an account', async ({ page }) => {
    await page.getByRole('button', { name: 'Create new Project' }).click();
    await expect.soft(page.getByLabel('Project Type: remote', { exact: true })).toBeDisabled();
    await expect.soft(page.getByLabel('Project Type: local', { exact: true })).toBeEnabled();
    const session = await page.evaluate(() => window._dataServicesInvoke('userSession', 'get'));
    expect.soft(session.id).toBe('');
    expect.soft(session.accountId).toBe('');
  });

  test('remote project discovery is rejected instead of returning invented cloud projects', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const before = await window._dataServicesInvoke('project', 'list');
      const results = await Promise.allSettled([
        window.main.sync.remoteBackendProjects({ teamId: 'org_offline', teamProjectId: 'local-test' }),
        window.main.sync.remoteBackendProjectsOfTeam({ teamId: 'org_offline' }),
      ]);
      return {
        before,
        after: await window._dataServicesInvoke('project', 'list'),
        errors: results.map(result => result.status === 'rejected' ? String(result.reason) : null),
      };
    });
    expect.soft(result.errors).toHaveLength(2);
    for (const error of result.errors) expect.soft(error).toContain('Remote project discovery is disabled');
    expect.soft(result.after).toEqual(result.before);
  });

  test('cloud push and pull fail before creating or changing a local backend project', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const workspaceId = 'wrk_offline_no_remote_transport';
      const before = await window.main.sync.hasBackendProjectForRootDocument(workspaceId);
      const results = await Promise.allSettled([
        window.main.sync.push(workspaceId, { teamId: 'org_offline', teamProjectId: 'local-test' }),
        window.main.sync.pull(workspaceId, { candidates: [], teamId: 'org_offline', teamProjectId: 'local-test', projectId: 'local-test' }),
      ]);
      return {
        before,
        after: await window.main.sync.hasBackendProjectForRootDocument(workspaceId),
        errors: results.map(result => result.status === 'rejected' ? String(result.reason) : null),
      };
    });
    expect.soft(result.before).toBe(false);
    expect.soft(result.after).toBe(false);
    expect.soft(result.errors).toHaveLength(2);
    for (const error of result.errors) expect.soft(error).toContain('Remote version-control operations are disabled');
  });

  test('remote branch listing, comparison and deletion cannot mutate local projects', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const before = await window._dataServicesInvoke('project', 'list');
      const workspaceId = 'wrk_offline_no_remote_branches';
      const results = await Promise.allSettled([
        window.main.sync.getRemoteBranchNames(workspaceId),
        window.main.sync.compareRemoteBranch(workspaceId),
        window.main.sync.removeRemoteBranch(workspaceId, 'must-not-delete'),
      ]);
      return {
        before,
        after: await window._dataServicesInvoke('project', 'list'),
        errors: results.map(result => result.status === 'rejected' ? String(result.reason) : null),
      };
    });
    expect.soft(result.errors).toHaveLength(3);
    for (const error of result.errors) expect.soft(error).toContain('Remote version-control operations are disabled');
    expect.soft(result.after).toEqual(result.before);
  });

  // Preserve the original positive regression: concurrently activated workspaces
  // must use separate local VCS instances and never overwrite one another.
  test('keeps concurrently-activated workspaces on their own backend project', async ({ page }) => {
    const workspaceA = { id: 'wrk_concurrency_test_a', name: 'Concurrency Test A' };
    const workspaceB = { id: 'wrk_concurrency_test_b', name: 'Concurrency Test B' };
    const result = await page.evaluate(async ({ a, b }) => {
      const sync = window.main.sync;
      await Promise.all([
        sync.switchAndCreateBackendProjectIfNotExist(a.id, a.id, a.name),
        sync.switchAndCreateBackendProjectIfNotExist(b.id, b.id, b.name),
      ]);
      const [activeA, activeB] = await Promise.all([
        sync.getActiveBackendProject(a.id), sync.getActiveBackendProject(b.id),
      ]);
      return { activeA, activeB };
    }, { a: workspaceA, b: workspaceB });
    expect.soft(result.activeA?.rootDocumentId).toBe(workspaceA.id);
    expect.soft(result.activeB?.rootDocumentId).toBe(workspaceB.id);
    expect.soft(result.activeA?.id).not.toBe(result.activeB?.id);
    await page.evaluate(async ({ a, b }) => {
      await window.main.sync.removeBackendProjectsForRoot(a.id);
      await window.main.sync.removeBackendProjectsForRoot(b.id);
    }, { a: workspaceA, b: workspaceB });
  });
});
