#!/usr/bin/env python3
"""Reviewed native-storage and local-only migration repairs. No cloud transport, retries or skips."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
changed = []


def replace(relative, before, after, count=1):
    file = ROOT / relative
    text = file.read_text(encoding='utf-8')
    if before not in text and after in text:
        return
    if text.count(before) != count:
        raise ValueError(f'Review anchor in {relative}: expected {count}, got {text.count(before)}')
    file.write_text(text.replace(before, after), encoding='utf-8', newline='\n')
    changed.append(relative)


app = 'packages/insomnia/src/'
smoke = 'packages/insomnia-smoke-test/'
secret = ROOT / (app + 'main/ipc/secret-storage.ts')
text = secret.read_text(encoding='utf-8')
assert 'return raw;' in text and 'return cipherText;' in text
start = text.index('export const encryptString')
end = text.index('export const registerSecretStorageHandlers', start)
text = text[:start] + '''// Failure is explicit: a missing/locked keyring must not silently persist raw
// credentials, and a failed decrypt must never return input as a "secret".
export const encryptString = (raw: string) => encryptWithNativeStorage(safeStorage, raw, process.platform);
export const decryptString = (cipherText: string) => decryptWithNativeStorage(safeStorage, cipherText, process.platform);

''' + text[end:]
text = text.replace("import { safeStorage } from 'electron';", "import { safeStorage } from 'electron';\n\nimport { decryptWithNativeStorage, encryptWithNativeStorage } from '../secure-storage-policy';")
secret.write_text(text, encoding='utf-8', newline='\n')
changed.append(str(secret.relative_to(ROOT)))

router = app + 'ui/utils/router.ts'
replace(router, "import { OFFLINE_BUILD, OFFLINE_ORGANIZATION_ID } from '~/common/offline';", "import { OFFLINE_BUILD, OFFLINE_ORGANIZATION_ID } from '~/common/offline';\nimport { canAdoptLegacyLocalProject } from '~/common/offline-project-migration';")
replace(router, "  if (OFFLINE_BUILD) {\n    return getInitialRouteForOrganization({ organizationId: OFFLINE_ORGANIZATION_ID, navigateToWorkspace: true });\n  }\n", '')
replace(router, '    const allProjects = await services.project.list();', '''    const allProjects = await services.project.list();
    if (OFFLINE_BUILD) {
      // Only orphaned local projects inside the explicitly selected offline data
      // directory are adopted. Preserve IDs/content and never adopt cloud records,
      // scratchpad data or projects already assigned to another organization.
      for (const project of allProjects.filter(canAdoptLegacyLocalProject)) {
        await services.project.update(project, { parentId: OFFLINE_ORGANIZATION_ID });
      }
    }''')
replace(router, '    const hasSeenOnboarding = Boolean(window.localStorage.getItem(HAS_SEEN_ONBOARDING_KEY));', '''    // Local filesystem migrations must run before the offline landing route.
    if (OFFLINE_BUILD) {
      return getInitialRouteForOrganization({ organizationId: OFFLINE_ORGANIZATION_ID, navigateToWorkspace: true });
    }
    const hasSeenOnboarding = Boolean(window.localStorage.getItem(HAS_SEEN_ONBOARDING_KEY));''')
replace(app + 'routes/git-migration.$.tsx', "import { Button } from '~/basic-components/button';", "import { Button } from '~/basic-components/button';\nimport { OFFLINE_BUILD, OFFLINE_ORGANIZATION_ID } from '~/common/offline';")
replace(app + 'routes/git-migration.$.tsx', "  const postMigrationPath =\n    typeof window", "  const postMigrationPath = OFFLINE_BUILD\n    ? `/organization/${OFFLINE_ORGANIZATION_ID}/project`\n    : typeof window")

# The focus-triggered combobox may already be open when its toggle receives a
# click. ArrowDown is deterministic for opening/focusing the actual option.
replace(smoke + 'playwright/pages/project/index.ts', "    await this.page.getByRole('button', { name: 'Show suggestions Branch' }).click();\n    await this.page.getByRole('option', { name: 'master' }).click();", "    await this.page.getByRole('combobox', { name: 'Search branches Branch' }).press('ArrowDown');\n    await this.page.getByRole('option', { name: 'master', exact: true }).click();", 2)

migration = smoke + 'tests/migration/git-repo-onboarding.test.ts'
replace(migration, 'shows Git migration first, then the v13 onboarding immediately after it completes', 'runs required Git migration before opening the account-free offline workspace')
replace(migration, '      // Do not pre-mark onboarding as seen — we want the v13 onboarding to appear\n      // immediately after the migration completes.', '      // Exercise the real startup and migration route, without fixture onboarding shortcuts.')
replace(migration, '    // 4. Opening Insomnia from the completed migration lands on the v13 onboarding.\n    await page.getByRole(\'link\', { name: \'Open Insomnia\' }).click();\n    await expect.soft(page.getByRole(\'heading\', { name: /Welcome to Insomnia 13/ })).toBeVisible();', '''    // 4. Opening Insomnia returns to local data, never login or online onboarding.
    await page.getByRole('link', { name: 'Open Insomnia' }).click();
    await expect.soft(page.getByTestId('offline-mode')).toBeVisible();
    await expect.soft(page.getByRole('heading', { name: /Welcome to Insomnia 13/ })).toBeHidden();
    const state = await page.evaluate(async () => ({
      project: await window._dataServicesInvoke('project', 'getById', 'proj_smoketestgit'),
      repository: await window._dataServicesInvoke('gitRepository', 'getById', 'git_smoketestpending'),
      session: await window._dataServicesInvoke('userSession', 'get'),
    }));
    expect.soft(state.project).toMatchObject({ name: 'Git Migration Smoke Project', parentId: 'org_offline', remoteId: null });
    expect.soft(state.repository?.repoMigrationVersion).toBeGreaterThan(0);
    expect.soft(state.session.id).toBe('');''')

# Only Git tests explicitly opt in to the test repository's exact origins.
replace(smoke + 'tests/smoke/custom-lint-rules.test.ts', "  test.describe('within a git-sync project', () => {", "  test.describe('within a git-sync project', () => {\n    test.use({ browserOrigins: ['http://localhost:4010', 'http://127.0.0.1:4010'] });")
print('\n'.join(changed))
