import fs from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import YAML from 'yaml';

import type { InsomniaApp } from '../../playwright/pages';
import { getFixturePath, randomDataPath } from '../../playwright/paths';
import { test } from '../../playwright/test';

const RULESET_FIXTURE = getFixturePath('files/custom.spectral.yaml');
const INVALID_RULESET_FIXTURE = getFixturePath('files/invalid.spectral.yaml');
const RULESET_RULE_NAME = 'require-x-smoke-test-marker';
const GIT_LINT_PROJECT_NAME = 'Git Lint Rules Test';

/**
 * Open a fresh design document seeded with the Pet Store example. The Pet Store
 * does not include `info.x-smoke-test-marker`, so once our custom ruleset is
 * uploaded the rule defined in fixtures/files/custom.spectral.yaml will fire.
 */
async function expandLintPanel(page: Page) {
  const lintButton = page.getByTestId('lint-panel-toggle');
  await expect.soft(lintButton).toBeVisible({ timeout: 15_000 });
  await lintButton.click();
  await expect.soft(page.getByTestId('lint-panel')).toBeAttached({ timeout: 15_000 });
}

async function openPetStoreDesignDoc(page: Page) {
  await page.getByRole('button', { name: 'Create document' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await page.getByText('Use example').click();
  await page.getByText('Pet Store').click();
  await expect.soft(page.locator('.pane-one').getByTestId('CodeEditor')).toContainText('openapi: 3.0');
}

async function uploadRuleset(insomnia: InsomniaApp, page: Page) {
  await insomnia.queueOpenDialogResponse([RULESET_FIXTURE]);
  await page.getByLabel('Upload custom ruleset').click();
  // Soft assert per ESLint rule; a failure here will surface downstream as well.
  await expect
    .soft(page.getByRole('button', { name: 'View selected ruleset content' }))
    .toBeVisible({ timeout: 10_000 });
}

async function removeRuleset(page: Page) {
  await page.getByLabel('Remove custom ruleset').click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect.soft(page.getByText('Default OAS Ruleset')).toBeVisible({ timeout: 10_000 });
}

async function addAccessTokenGitCredential(insomnia: InsomniaApp) {
  await insomnia.statusbar.openPreferences();
  await insomnia.preferencesPage.switchToPreferenceTab('Credentials');
  await insomnia.preferencesPage.credentialsTab.addAccessTokenGitCredential();
  await expect.soft(insomnia.page.getByRole('row', { name: 'Custom Git Credential' })).toBeVisible();
  await insomnia.preferencesPage.closePreferences();
}

async function createGitDesignDocument(insomnia: InsomniaApp, page: Page, projectName: string) {
  await insomnia.navigationSidebar.selectProjectDropdownOption({
    actionName: 'API Collection',
    projectName,
  });
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Lint Test Spec');
  await page.getByRole('textbox', { name: /File name/ }).fill('lint_test_spec');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page
    .getByRole('dialog')
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {});
  // Populate with Pet Store example so the lint panel renders (requires non-empty apiSpec.contents).
  await page.getByText('Use example').click();
  await page.getByText('Pet Store').click();
  await expect.soft(page.locator('.pane-one').getByTestId('CodeEditor')).toContainText('openapi: 3.0');
}

// Mirrors models.gitRepository.getGitRepoFolderName()'s safety check on
// `folderSlug` before baking it into a filesystem path.
const SAFE_FOLDER_SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * Find the RepoFileWatcher mirror directory for the first GitRepository in
 * `dataPath`.  Polls for up to 6 seconds because NeDB flushes to disk
 * asynchronously after the project is created.
 *
 * Mirrors the app's own path resolution (see `getRepoBaseDir` /
 * `models.gitRepository.getGitRepoFolderName`): a user-chosen `directory`
 * wins when set; otherwise the managed folder is named `git_<slug>_<hex>`
 * once a `folderSlug` has been recorded (set at clone time, or by the
 * one-time startup backfill for older repos), falling back to the bare id
 * only when neither applies.
 */
async function gitRepoMirrorPath(dataPath: string): Promise<string> {
  const dbPath = path.join(dataPath, 'insomnia.GitRepository.db');
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const content = await fs.promises.readFile(dbPath, 'utf8');
      // NeDB's on-disk format is an append-only log: an update appends a new
      // line for the same `_id` rather than rewriting it in place (e.g. the
      // folderSlug update that follows creation). Replay all lines in order,
      // keyed by `_id`, so the last write for a given repo wins.
      const byId = new Map<string, any>();
      for (const line of content.split('\n')) {
        if (!line) {
          continue;
        }
        const doc = JSON.parse(line);
        byId.set(doc._id, doc);
      }
      const repos = [...byId.values()].filter((r: any) => !r.$$deleted);
      if (repos.length > 0) {
        const repo = repos[0];
        if (repo.directory) {
          return repo.directory;
        }
        const slug = repo.folderSlug;
        const folderName =
          typeof slug === 'string' && SAFE_FOLDER_SLUG_PATTERN.test(slug)
            ? `git_${slug}_${(repo._id as string).replace(/^git_/, '')}`
            : repo._id;
        return path.join(dataPath, 'version-control', 'git', folderName);
      }
    } catch {
      // file not yet written
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`No GitRepository found in ${dbPath} after waiting`);
}

test.describe('Custom Spectral Lint Rules', () => {
  // ---------------------------------------------------------------------------
  // 1. Upload + lint + reopen (full process relaunch)
  // ---------------------------------------------------------------------------
  test('upload custom ruleset, lint reflects it, persists after app relaunch', async ({ insomnia }) => {
    await openPetStoreDesignDoc(insomnia.page);

    // Baseline: Pet Store should produce no lint problems under default OAS ruleset.
    await expect.soft(insomnia.page.getByText('Default OAS Ruleset')).toBeVisible();
    await expect.soft(insomnia.page.getByText('No lint problems')).toBeVisible({ timeout: 15_000 });

    await uploadRuleset(insomnia, insomnia.page);

    // Our custom rule should now fire on Pet Store.
    await expandLintPanel(insomnia.page);
    await expect.soft(insomnia.page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible({
      timeout: 15_000,
    });

    // Capture error/warning counts before relaunch so we can assert persistence.
    const lintToggle = insomnia.page.getByTestId('lint-panel-toggle');
    await expect.soft(lintToggle).toBeVisible({ timeout: 15_000 });
    const lintSummaryBefore = await lintToggle.textContent();

    // Close the Electron process and relaunch it against the same data path.
    // This exercises the full persistence boundary: NeDB on disk, main-process
    // startup, renderer init, clientLoader.
    await insomnia.relaunch();

    // Re-navigate to the same design document after relaunch. The workspace is
    // created with the default name 'My API Collection'.
    await insomnia.page.getByLabel('My API Collection').first().click();

    await expect
      .soft(insomnia.page.getByRole('button', { name: 'View selected ruleset content' }))
      .toBeVisible({ timeout: 15_000 });

    // Assert same error/warning counts as before relaunch (ruleset persisted).
    const lintToggleAfter = insomnia.page.getByTestId('lint-panel-toggle');
    await expect.soft(lintToggleAfter).toHaveText(lintSummaryBefore ?? '', { timeout: 15_000 });
  });

  // ---------------------------------------------------------------------------
  // 2. Remove + reopen (full process relaunch)
  // ---------------------------------------------------------------------------
  test('remove custom ruleset reverts to default OAS, persists after app relaunch', async ({ insomnia }) => {
    await openPetStoreDesignDoc(insomnia.page);
    await uploadRuleset(insomnia, insomnia.page);
    await expandLintPanel(insomnia.page);
    await expect.soft(insomnia.page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible({
      timeout: 15_000,
    });

    await removeRuleset(insomnia.page);
    await expect.soft(insomnia.page.getByText(new RegExp(RULESET_RULE_NAME))).toBeHidden();
    await expect.soft(insomnia.page.getByText('No lint problems')).toBeVisible({ timeout: 15_000 });

    await insomnia.relaunch();
    await insomnia.page.getByLabel('My API Collection').first().click();

    await expect.soft(insomnia.page.getByText('Default OAS Ruleset')).toBeVisible({ timeout: 15_000 });
    await expect.soft(insomnia.page.getByText(new RegExp(RULESET_RULE_NAME))).toBeHidden();
  });

  // ---------------------------------------------------------------------------
  // 3. Invalid ruleset — error modal appears, ruleset is not applied
  // ---------------------------------------------------------------------------
  test('uploading a ruleset with disallowed keys shows an error and leaves default ruleset active', async ({
    insomnia,
  }) => {
    await openPetStoreDesignDoc(insomnia.page);
    await expect.soft(insomnia.page.getByText('Default OAS Ruleset')).toBeVisible();

    await insomnia.queueOpenDialogResponse([INVALID_RULESET_FIXTURE]);
    await insomnia.page.getByLabel('Upload custom ruleset').click();

    await expect.soft(insomnia.page.getByText('Invalid Spectral Ruleset', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await insomnia.page.getByRole('dialog', { name: 'Modal' }).getByRole('button', { name: 'Ok' }).click();

    // Default ruleset should still be active; no custom upload button state change.
    await expect.soft(insomnia.page.getByText('Default OAS Ruleset')).toBeVisible();
    await expect.soft(insomnia.page.getByRole('button', { name: 'View selected ruleset content' })).toBeHidden();
  });

  // ---------------------------------------------------------------------------
  // 4. Cloud sync — upload, reload, and three sync round-trips
  //
  // The custom ruleset is stored as a `ProjectLintRuleset` doc (canSync = true)
  // parented to the project, so it rides cloud-sync push/pull with the rest of
  // the project's resources.
  // ---------------------------------------------------------------------------
  test.describe('local rulesets at the offline cloud boundary', () => {
    test('a rejected cloud push leaves the active local ruleset unchanged', async ({ insomnia, page }) => {
      await openPetStoreDesignDoc(page);
      await uploadRuleset(insomnia, page);
      await expandLintPanel(page);
      await expect.soft(page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
      const workspaceId = new URL(page.url()).pathname.match(/\/workspace\/([^/]+)/)?.[1];
      expect.soft(workspaceId).toBeTruthy();
      const error = await page.evaluate(async id => {
        return window.main.sync.push(id!, { teamId: 'org_offline', teamProjectId: 'local-only' })
          .then(() => null, String);
      }, workspaceId);
      expect.soft(error).toContain('Remote version-control operations are disabled');
      await expect.soft(page.getByRole('button', { name: 'View selected ruleset content' })).toBeVisible();
      await expect.soft(page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
    });

    test('separate local profiles share a ruleset only through explicit local import', async ({ insomnia, page }) => {
      await openPetStoreDesignDoc(page);
      await uploadRuleset(insomnia, page);
      await expandLintPanel(page);
      await expect.soft(page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
      const other = await insomnia.launchClone(randomDataPath());
      try {
        await openPetStoreDesignDoc(other.page);
        await expect.soft(other.page.getByText('Default OAS Ruleset')).toBeVisible();
        await expect.soft(other.page.getByText('No lint problems')).toBeVisible();
        await uploadRuleset(other, other.page);
        await expandLintPanel(other.page);
        await expect.soft(other.page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
        const sessions = await Promise.all([
          page.evaluate(() => window._dataServicesInvoke('userSession', 'get')),
          other.page.evaluate(() => window._dataServicesInvoke('userSession', 'get')),
        ]);
        expect.soft(sessions.map(session => session.id)).toEqual(['', '']);
      } finally {
        await other.app.close();
      }
    });

    test('a rejected remote branch deletion does not prevent explicit local ruleset removal', async ({ insomnia, page }) => {
      await openPetStoreDesignDoc(page);
      await uploadRuleset(insomnia, page);
      await expandLintPanel(page);
      await expect.soft(page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
      const workspaceId = new URL(page.url()).pathname.match(/\/workspace\/([^/]+)/)?.[1];
      expect.soft(workspaceId).toBeTruthy();
      const error = await page.evaluate(async id => {
        return window.main.sync.removeRemoteBranch(id!, 'must-not-delete')
          .then(() => null, String);
      }, workspaceId);
      expect.soft(error).toContain('Remote version-control operations are disabled');
      await expect.soft(page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
      await removeRuleset(page);
      await expect.soft(page.getByText('Default OAS Ruleset')).toBeVisible();
      await expect.soft(page.getByText('No lint problems')).toBeVisible();
    });
  });

  test.describe('within a git-sync project', () => {
    test.use({ browserOrigins: ['http://localhost:4010', 'http://127.0.0.1:4010'] });
    test.slow();

    test.beforeEach(async ({ insomnia, request }) => {
      await request.post('http://127.0.0.1:4010/v1/test-utils/git/setup');
      await addAccessTokenGitCredential(insomnia);
      await insomnia.projectPage.createGitSyncProject(GIT_LINT_PROJECT_NAME);
      await createGitDesignDocument(insomnia, insomnia.page, GIT_LINT_PROJECT_NAME);
    });

    test.afterEach(async ({ request }) => {
      await request.delete('http://127.0.0.1:4010/v1/test-utils/git/setup');
    });

    test('4a. upload ruleset via UI mirrors to .spectral.yaml on disk', async ({ insomnia, dataPath }) => {
      const mirrorDir = await gitRepoMirrorPath(dataPath);
      await uploadRuleset(insomnia, insomnia.page);

      const spectralPath = path.join(mirrorDir, '.spectral.yaml');
      await expect.poll(() => fs.existsSync(spectralPath), { timeout: 10_000 }).toBe(true);

      const onDisk = await fs.promises.readFile(spectralPath, 'utf8');
      const fixture = await fs.promises.readFile(RULESET_FIXTURE, 'utf8');
      expect.soft(YAML.parse(onDisk)).toEqual(YAML.parse(fixture));
    });

    test('4b. .spectral.yaml on disk syncs to UI badge', async ({ insomnia, dataPath }) => {
      await expect.soft(insomnia.page.getByText('Default OAS Ruleset')).toBeVisible({ timeout: 10_000 });

      const mirrorDir = await gitRepoMirrorPath(dataPath);
      const fixture = await fs.promises.readFile(RULESET_FIXTURE, 'utf8');
      await fs.promises.writeFile(path.join(mirrorDir, '.spectral.yaml'), fixture, 'utf8');

      // The RepoFileWatcher debounces at 300 ms then writes to NeDB; the renderer
      // picks up the db.changes IPC event and re-renders.
      await expect
        .soft(insomnia.page.getByRole('button', { name: 'View selected ruleset content' }))
        .toBeVisible({ timeout: 15_000 });
    });

    test('4c. remove ruleset via UI deletes .spectral.yaml from disk', async ({ insomnia, dataPath }) => {
      const mirrorDir = await gitRepoMirrorPath(dataPath);
      await uploadRuleset(insomnia, insomnia.page);

      const spectralPath = path.join(mirrorDir, '.spectral.yaml');
      await expect.poll(() => fs.existsSync(spectralPath), { timeout: 10_000 }).toBe(true);

      await removeRuleset(insomnia.page);
      await expect.poll(() => !fs.existsSync(spectralPath), { timeout: 10_000 }).toBe(true);
    });
  });
});
