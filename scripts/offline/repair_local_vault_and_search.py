#!/usr/bin/env python3
"""Reviewed local capability repairs. Does not enable cloud services or skip tests."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
changed = []


def replace(relative, before, after, count=1):
    file = ROOT / relative
    text = file.read_text(encoding='utf-8')
    if before not in text and after in text:
        return
    if text.count(before) != count:
        raise ValueError(f'Review anchor changed: {relative}: expected {count}, got {text.count(before)}')
    file.write_text(text.replace(before, after), encoding='utf-8', newline='\n')
    if relative not in changed:
        changed.append(relative)


app = 'packages/insomnia/src/'
smoke = 'packages/insomnia-smoke-test/'
model = 'packages/insomnia-data/src/models/user-session.ts'
replace(model, '  vaultKey?: string;', '  vaultKey?: string;\n  /** Versioned local AES-GCM key proof; never synchronized to a server. */\n  offlineVaultProof?: string;')
replace(model, "    vaultSalt: '',", "    vaultSalt: '',\n    offlineVaultProof: '',")

vault = app + 'ui/vault-key.client.ts'
replace(vault, "import { base64encode, saveVaultKeyIfNecessary } from '~/common/utils/vault';", "import { OFFLINE_BUILD } from '~/common/offline';\nimport { createOfflineVaultProof, verifyOfflineVaultProof } from '~/common/utils/offline-vault-proof';\nimport { base64encode, saveVaultKeyIfNecessary } from '~/common/utils/vault';")
replace(vault, '    // Compute the verifier', """    if (OFFLINE_BUILD) {
      if (type === 'create' && userSession.vaultSalt) {
        return { error: 'A local vault already exists. Unlock it or explicitly reset it.' };
      }
      const offlineVaultProof = await createOfflineVaultProof(base64encodedVaultKey, vaultSalt, accountId);
      const encryptedVaultKey = await window.main.secretStorage.encryptString(base64encodedVaultKey);
      // Persist key, salt and proof together. Never register a vendor account or verifier.
      await services.userSession.update({ vaultSalt, vaultKey: encryptedVaultKey, offlineVaultProof });
      await saveVaultKeyIfNecessary(accountId, base64encodedVaultKey);
      return { key: base64encodedVaultKey };
    }
    // Compute the verifier""")
replace(vault, '  const secret1 = await srpGenKey();', """  if (OFFLINE_BUILD) {
    const valid = await verifyOfflineVaultProof(vaultKey, session.offlineVaultProof, vaultSalt, accountId);
    // The legacy return shape is retained, but this marker is not an SRP session
    // key and is never sent to a server. Callers use it only as a validation result.
    return valid ? 'offline-local-vault-validated' : false;
  }
  const secret1 = await srpGenKey();""")

panel = app + 'ui/components/settings/vault-key-panel.tsx'
replace(panel, "import React, { useCallback, useEffect, useState } from 'react';", "import { services } from 'insomnia-data';\nimport React, { useCallback, useEffect, useState } from 'react';\nimport { useRevalidator } from 'react-router';")
replace(panel, "import { getProductName } from '~/common/constants';", "import { getProductName } from '~/common/constants';\nimport { OFFLINE_BUILD } from '~/common/offline';")
replace(panel, '  const { saveVaultKeyLocally } = settings;', '  const { saveVaultKeyLocally } = settings;\n  const { revalidate } = useRevalidator();')
replace(panel, '      {vaultSaltExists && vaultKeyExists && vaultKeyValue !== \'\' && (', """      {OFFLINE_BUILD && vaultSaltExists && vaultKeyExists && (
        <Button
          className="btn btn--outlined btn--super-compact"
          onPress={async () => {
            await deleteVaultKeyFromStorage(accountId);
            await services.userSession.update({ vaultKey: '' });
            setVaultKeyValue('');
            await revalidate();
          }}
        >
          Lock Vault
        </Button>
      )}
      {vaultSaltExists && vaultKeyExists && vaultKeyValue !== '' && (""")

general = app + 'ui/components/settings/general.tsx'
replace(general, "import { useRootLoaderData } from '~/root';", "import { OFFLINE_BUILD } from '~/common/offline';\nimport { useRootLoaderData } from '~/root';")
replace(general, '{isLoggedIn && <VaultKeyPanel />}', '{(OFFLINE_BUILD || isLoggedIn) && <VaultKeyPanel />}')

salt = app + 'routes/auth.update-vault-salt.tsx'
replace(salt, "import { createFetcherSubmitHook } from '~/ui/utils/router';", "import { OFFLINE_BUILD } from '~/common/offline';\nimport { createFetcherSubmitHook } from '~/ui/utils/router';")
replace(salt, '    const { id: sessionId } = userSession;', '    if (OFFLINE_BUILD) return userSession.vaultSalt;\n    const { id: sessionId } = userSession;')
clear = app + 'routes/auth.clear-vault-key.tsx'
replace(clear, "import { showToast } from '~/ui/components/toast-notification';", "import { OFFLINE_BUILD } from '~/common/offline';\nimport { showToast } from '~/ui/components/toast-notification';")
replace(clear, '  const { organizations = [], sessionId: resetVaultClientSessionId } = await request.json();', "  // Vendor reset notifications cannot erase this independent local vault.\n  if (OFFLINE_BUILD) return false;\n  const { organizations = [], sessionId: resetVaultClientSessionId } = await request.json();")
replace(app + 'common/utils/vault.ts', 'console.error(`failed to base64 decode string ${base64Str}`);', "console.error('Failed to decode vault data');")

search = app + 'ui/hooks/use-command-search.ts'
replace(search, "import { useCallback, useEffect, useRef, useState } from 'react';", "import { useCallback, useEffect, useRef, useState } from 'react';\n\nimport { OFFLINE_BUILD, OFFLINE_ORGANIZATION } from '~/common/offline';")
replace(search, '      const allOrganizations = [', '      const allOrganizations = OFFLINE_BUILD ? [OFFLINE_ORGANIZATION] : [')
remote = app + 'routes/remote-files.tsx'
replace(remote, "import { createFetcherLoadHook } from '~/ui/utils/router';", "import { OFFLINE_BUILD } from '~/common/offline';\nimport { createFetcherLoadHook } from '~/ui/utils/router';")
replace(remote, '  const { id: sessionId, accountId } = await services.userSession.get();', "  if (OFFLINE_BUILD) return { files: [] };\n  const { id: sessionId, accountId } = await services.userSession.get();")

replace(smoke + 'tests/smoke/socket-io.test.ts', 'page.getByText("Connect").click()', "page.getByRole('button', { name: 'Connect', exact: true }).click()", 2)
replace(smoke + 'tests/smoke/pre-request-script-features.test.ts', "    await dialog.getByRole('button', { name: 'Close' }).click();\n    await page.locator('body').click();", "    await dialog.getByRole('button', { name: 'Close' }).click();\n    await expect(dialog).toBeHidden();\n    await page.keyboard.press('Escape');")

ui = smoke + 'tests/smoke/insomnia-vault.test.ts'
replace(ui, "  test('check reset and validate vault key',", """  test.beforeEach(async ({ page }) => {
    // Exercise a real local key and proof, not a mocked vendor SRP session.
    await page.getByTestId('settings-button').click();
    await page.getByRole('button', { name: 'Generate Vault Key' }).click();
    await expect(page.getByTestId('VaultKeyDisplayPanel')).not.toHaveText('');
    await page.getByRole('button', { name: 'Lock Vault', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enter Vault Key' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('check reset and validate vault key',""")
print('\n'.join(changed))
