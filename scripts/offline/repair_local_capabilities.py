#!/usr/bin/env python3
"""Narrow reviewed repairs. Keep cloud services, arbitrary browser origins and sandbox bypasses disabled."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
changed = []


def replace(relative, before, after, count=1):
    file = ROOT / relative
    text = file.read_text(encoding='utf-8')
    if before not in text and after in text:
        return
    if text.count(before) != count:
        raise ValueError(f'Review source anchor in {relative}: expected {count}, got {text.count(before)}')
    file.write_text(text.replace(before, after), encoding='utf-8', newline='\n')
    if relative not in changed:
        changed.append(relative)


app = 'packages/insomnia/src/'
smoke = 'packages/insomnia-smoke-test/'
replace(app + 'root.tsx',
        "if (!userSession.id) {\n          window.sessionStorage.setItem('pendingDeepLinkAfterAuthorize', url);",
        "if (!OFFLINE_BUILD && !userSession.id) {\n          window.sessionStorage.setItem('pendingDeepLinkAfterAuthorize', url);", 2)

route = app + 'routes/organization.$organizationId.project.new.tsx'
replace(route, 'if (models.organization.isLocalOrganizationId(organizationId)) {',
        'if (OFFLINE_BUILD || models.organization.isLocalOrganizationId(organizationId)) {')
replace(route,
        "    invariant(newProjectData.storageType === 'local', 'Only local storage is available in this offline build');\n    invariant(typeof newProjectData.name === 'string' && newProjectData.name.trim().length > 0, 'Project name is required');\n    const project = await services.project.create({ name: newProjectData.name, parentId: organizationId });\n    return project._id;\n  }\n  const user = await services.userSession.get();\n  const sessionId = user.id;\n  invariant(sessionId, 'User must be logged in to create a project');\n  invariant(\n    newProjectData.storageType === 'local' || !models.organization.isLocalOrganizationId(organizationId),",
        "    invariant(newProjectData.storageType === 'local' || newProjectData.storageType === 'git', 'Cloud storage is disabled in this offline build');\n    invariant(typeof newProjectData.name === 'string' && newProjectData.name.trim().length > 0, 'Project name is required');\n  }\n  // Local and explicitly selected Git repositories do not need a vendor account.\n  const user = OFFLINE_BUILD ? null : await services.userSession.get();\n  const sessionId = user?.id || '';\n  invariant(OFFLINE_BUILD || sessionId, 'User must be logged in to create a project');\n  invariant(\n    OFFLINE_BUILD || newProjectData.storageType === 'local' || !models.organization.isLocalOrganizationId(organizationId),")

rules = app + 'common/organization-storage-rules.ts'
replace(rules, "import type { StorageRules } from 'insomnia-api';", "import type { StorageRules } from 'insomnia-api';\n\nimport { OFFLINE_ORGANIZATION_ID } from './offline';")
replace(rules, 'export async function fetchAndCacheOrganizationStorageRule(',
        "// These are local capabilities, not fabricated cloud entitlements.\nexport const OFFLINE_STORAGE_RULES: StorageRules = { ...DEFAULT_STORAGE_RULES, enableGitSync: true };\n\nexport async function fetchAndCacheOrganizationStorageRule(")
replace(rules, '  _organizationId: string | undefined,', '  organizationId: string | undefined,')
replace(rules, '  return { ...DEFAULT_STORAGE_RULES };',
        '  return { ...(organizationId === OFFLINE_ORGANIZATION_ID ? OFFLINE_STORAGE_RULES : DEFAULT_STORAGE_RULES) };')

hook = app + 'ui/hooks/use-organization-storage-rule.ts'
replace(hook,
        "import { DEFAULT_STORAGE_RULES, fetchAndCacheOrganizationStorageRule } from '~/common/organization-storage-rules';",
        "import { OFFLINE_BUILD, OFFLINE_ORGANIZATION_ID } from '~/common/offline';\nimport { DEFAULT_STORAGE_RULES, OFFLINE_STORAGE_RULES, fetchAndCacheOrganizationStorageRule } from '~/common/organization-storage-rules';")
replace(hook, '    enabled: !!organizationId,', '    enabled: !OFFLINE_BUILD && !!organizationId,')
replace(hook, '  return data ?? DEFAULT_STORAGE_RULES;',
        '  if (OFFLINE_BUILD) return organizationId === OFFLINE_ORGANIZATION_ID ? OFFLINE_STORAGE_RULES : DEFAULT_STORAGE_RULES;\n  return data ?? DEFAULT_STORAGE_RULES;')

features = app + 'ui/hooks/use-organization-features.tsx'
replace(features, "import { useServerQuery } from '~/ui/hooks/use-query';",
        "import { OFFLINE_BUILD, OFFLINE_ORGANIZATION_ID } from '~/common/offline';\nimport { useServerQuery } from '~/ui/hooks/use-query';")
replace(features, '// If network unreachable assume user has paid for the current period',
        "// Account-free capabilities of the local offline organization. No backend subscription is created.\nconst offlineFeatures: FeatureList = Object.freeze({\n  ...fallbackFeatures,\n  bulkImport: { enabled: true, reason: 'Local offline capability' },\n  gitSync: { enabled: true, reason: 'User-managed Git repository' },\n});\n\n// The offline organization uses local capabilities and never requests billing information.")
replace(features, '  const isEnabled = !!organizationId && !models.organization.isLocalOrganizationId(organizationId);',
        '  const isEnabled = !OFFLINE_BUILD && !!organizationId && !models.organization.isLocalOrganizationId(organizationId);')
replace(features, '    features: data?.features ?? fallbackFeatures,',
        '    features: OFFLINE_BUILD ? (organizationId === OFFLINE_ORGANIZATION_ID ? offlineFeatures : fallbackFeatures) : data?.features ?? fallbackFeatures,')

policy = app + 'common/offline-policy.ts'
replace(policy, "    if (url.protocol === 'data:' || url.protocol === 'blob:') return true;",
        "    // The PDF viewer is packaged with Chromium; this exact extension is a local resource.\n    // Other extensions, chrome:// pages and network origins remain denied.\n    if (url.protocol === 'chrome-extension:') {\n      return url.hostname === 'mhjfbmdgcfjbbpaeojofohoefgiehjai' && url.port === '';\n    }\n    if (url.protocol === 'data:' || url.protocol === 'blob:') return true;")

editor = app + 'ui/components/.client/codemirror/one-line-editor.tsx'
replace(editor, '        onAutoFocus?.();\n        // An enclosing React Aria ListBox',
        '        const initiatingControl = document.activeElement;\n        let focusedOnce = false;\n        // An enclosing React Aria ListBox')
replace(editor, '            if (userMovedToAnotherControl) {',
        '            // The Add button is still focused when its newly created editor mounts.\n            // Allow the first focus handoff from that initiating control, but respect later input.\n            if (userMovedToAnotherControl && (focusedOnce || active !== initiatingControl)) {')
replace(editor, '          if (Date.now() < deadline) {\n            requestAnimationFrame(ensureFocus);',
        '          if (!focusedOnce && cm.hasFocus()) {\n            focusedOnce = true;\n            onAutoFocus?.();\n          }\n          if (Date.now() < deadline) {\n            requestAnimationFrame(ensureFocus);')

replace(smoke + 'playwright/launch.ts', '  INSOMNIA_DATA_PATH: string;',
        '  INSOMNIA_DATA_PATH: string;\n  INSOMNIA_OFFLINE_BROWSER_ORIGINS?: string;')
replace(smoke + 'playwright/test.ts', '  dataPath: string;\n  fixturesPath: string;',
        '  dataPath: string;\n  browserOrigins: string[];\n  fixturesPath: string;')
replace(smoke + 'playwright/test.ts', '  app: async ({ playwright, trace, dataPath, userConfig }, use, testInfo) => {',
        '  browserOrigins: [[], { option: true }],\n  app: async ({ playwright, trace, dataPath, userConfig, browserOrigins }, use, testInfo) => {')
replace(smoke + 'playwright/test.ts', '      INSOMNIA_DATA_PATH: dataPath,',
        "      INSOMNIA_DATA_PATH: dataPath,\n      // Empty by default. Only tests exercising an explicitly configured intranet IdP opt in.\n      INSOMNIA_OFFLINE_BROWSER_ORIGINS: JSON.stringify(browserOrigins),")
replace(smoke + 'tests/smoke/oauth.test.ts', "test('can make oauth2 requests',",
        "// Explicitly approve only the two loopback names used by the test IdP and callback.\n// This does not relax the application's default browser policy.\ntest.use({ browserOrigins: ['http://127.0.0.1:4010', 'http://localhost:4010'] });\n\ntest('can make oauth2 requests',")
replace(smoke + 'tests/smoke/command-palette.test.ts',
        "  await page.getByPlaceholder('Search and switch between').fill('send js');\n  await page.getByPlaceholder('Search and switch between').press('ArrowDown');",
        "  await page.getByPlaceholder('Search and switch between').fill('send js');\n  // Results arrive asynchronously over IPC; do not press Enter on the previous search.\n  await page.getByRole('option').filter({ hasText: /sends.*json/i }).first().waitFor();\n  await page.getByPlaceholder('Search and switch between').press('ArrowDown');")
print('\n'.join(changed))
