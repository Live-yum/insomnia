#!/usr/bin/env python3
"""Replace cloud collaboration assumptions with positive local persistence and negative cloud-boundary assertions."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
file = ROOT / 'packages/insomnia-smoke-test/tests/smoke/custom-lint-rules.test.ts'
text = file.read_text(encoding='utf-8')
start = text.index("  test.describe('within a cloud-sync project', () => {")
end = text.index("  test.describe('within a git-sync project', () => {", start)
replacement = '''  test.describe('local rulesets at the offline cloud boundary', () => {
    test('a rejected cloud push leaves the active local ruleset unchanged', async ({ insomnia, page }) => {
      await openPetStoreDesignDoc(page);
      await uploadRuleset(insomnia, page);
      await expandLintPanel(page);
      await expect(page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
      const workspaceId = new URL(page.url()).pathname.match(/\\/workspace\\/([^/]+)/)?.[1];
      expect(workspaceId).toBeTruthy();
      const error = await page.evaluate(async id => {
        return window.main.sync.push(id!, { teamId: 'org_offline', teamProjectId: 'local-only' })
          .then(() => null, error => String(error));
      }, workspaceId);
      expect(error).toContain('Remote version-control operations are disabled');
      await expect(page.getByRole('button', { name: 'View selected ruleset content' })).toBeVisible();
      await expect(page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
    });

    test('separate local profiles share a ruleset only through explicit local import', async ({ insomnia, page }) => {
      await openPetStoreDesignDoc(page);
      await uploadRuleset(insomnia, page);
      await expandLintPanel(page);
      await expect(page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
      const other = await insomnia.launchClone(randomDataPath());
      try {
        await openPetStoreDesignDoc(other.page);
        await expect(other.page.getByText('Default OAS Ruleset')).toBeVisible();
        await expect(other.page.getByText('No lint problems')).toBeVisible();
        await uploadRuleset(other, other.page);
        await expandLintPanel(other.page);
        await expect(other.page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
        const sessions = await Promise.all([
          page.evaluate(() => window._dataServicesInvoke('userSession', 'get')),
          other.page.evaluate(() => window._dataServicesInvoke('userSession', 'get')),
        ]);
        expect(sessions.map(session => session.id)).toEqual(['', '']);
      } finally {
        await other.app.close();
      }
    });

    test('a rejected remote branch deletion does not prevent explicit local ruleset removal', async ({ insomnia, page }) => {
      await openPetStoreDesignDoc(page);
      await uploadRuleset(insomnia, page);
      await expandLintPanel(page);
      await expect(page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
      const workspaceId = new URL(page.url()).pathname.match(/\\/workspace\\/([^/]+)/)?.[1];
      expect(workspaceId).toBeTruthy();
      const error = await page.evaluate(async id => {
        return window.main.sync.removeRemoteBranch(id!, 'must-not-delete')
          .then(() => null, error => String(error));
      }, workspaceId);
      expect(error).toContain('Remote version-control operations are disabled');
      await expect(page.getByText(new RegExp(RULESET_RULE_NAME))).toBeVisible();
      await removeRuleset(page);
      await expect(page.getByText('Default OAS Ruleset')).toBeVisible();
      await expect(page.getByText('No lint problems')).toBeVisible();
    });
  });

'''
text = text[:start] + replacement + text[end:]
start = text.index('/**\n * User B session:')
end = text.index('/**\n * Open a fresh design document', start)
text = text[:start] + text[end:]
if text.count('commitAndPush(') == 1:
    start = text.index('async function commitAndPush(')
    end = text.index('async function addAccessTokenGitCredential(', start)
    text = text[:start] + text[end:]
if text.count('devServerUrl') == 1:
    text = text.replace("import playwrightConfig from '../../playwright.config';\n", '')
    start = text.index('const webServerEntry =')
    end = text.index('const RULESET_FIXTURE =', start)
    text = text[:start] + text[end:]
file.write_text(text, encoding='utf-8', newline='\n')
print(file.relative_to(ROOT))
