#!/usr/bin/env python3
"""Reviewed repairs for local Git navigation and explicit intranet/test state."""
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
replace(app + 'routes/organization.$organizationId.project.$projectId.tsx',
        "invariant(!project.remoteId && !project.gitRepositoryId, 'Import this project into local storage before using it offline');",
        "invariant(!project.remoteId, 'Import cloud projects into local storage before using them offline');\n    invariant(!project.gitRepositoryId || organizationId === OFFLINE_ORGANIZATION_ID, 'Git projects require the local offline organization');")

origins = "// Explicitly approve only the local Git test service; production defaults remain deny-by-default.\ntest.use({ browserOrigins: ['http://localhost:4010', 'http://127.0.0.1:4010'] });\n"
for name in ['git-sync', 'git-repo-relocation']:
    replace(smoke + f'tests/smoke/{name}.test.ts', "import { test } from '../../playwright/test';", "import { test } from '../../playwright/test';\n\n" + origins)
replace(smoke + 'tests/smoke/git-local-repos.test.ts', "test.describe('Git clone into a user-chosen folder', () => {", "test.describe('Git clone into a user-chosen folder', () => {\n  " + origins)
replace(smoke + 'playwright/pages/project/index.ts',
        "    await this.clickReliably(this.page.getByRole('button', { name: 'Personal workspace Organizations' }));\n    await this.page.getByRole('option', { name: /Magic/ }).click();\n    await this.page.getByRole('button', { name: /Magic/ }).click();\n    await this.page.getByRole('option', { name: 'Personal workspace' }).locator('span').click();",
        "    // A local project must appear without switching to a cloud organization.\n    await this.page.getByRole('grid', { name: 'Project Navigation Tree' }).getByRole('row', { name, exact: true }).waitFor();")
replace(smoke + 'tests/smoke/command-palette.test.ts', '/sends.*json/i', '/send.*json/i')

launch = smoke + 'playwright/launch.ts'
replace(launch, "import { createOfflineTestProject } from './offline-project';", "import { createOfflineVaultProof } from '../../insomnia/src/common/utils/offline-vault-proof';\n\nimport { createOfflineTestProject } from './offline-project';")
replace(launch, '      preparedBuildProfiles.add(dataPath);', """      if (envOptions.INSOMNIA_VAULT_KEY && envOptions.INSOMNIA_VAULT_SALT) {
        // Legacy encrypted-data fixtures need a matching, real LOCAL key proof.
        // Seed fixture state through the normal data/secret-storage APIs, never
        // invent a vendor session or relax the application's verifier.
        const session = await page.evaluate(() => window._dataServicesInvoke('userSession', 'get'));
        const proof = await createOfflineVaultProof(
          envOptions.INSOMNIA_VAULT_KEY, envOptions.INSOMNIA_VAULT_SALT, session.accountId,
        );
        await page.evaluate(async ({ key, salt, proof }) => {
          const encrypted = await window.main.secretStorage.encryptString(key);
          await window._dataServicesInvoke('userSession', 'update', {
            vaultKey: encrypted, vaultSalt: salt, offlineVaultProof: proof,
          });
        }, { key: envOptions.INSOMNIA_VAULT_KEY, salt: envOptions.INSOMNIA_VAULT_SALT, proof });
        await page.reload();
        await page.getByTestId('offline-mode').waitFor({ state: 'visible' });
      }
      preparedBuildProfiles.add(dataPath);""")

print('\n'.join(changed))
