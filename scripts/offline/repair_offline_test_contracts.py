#!/usr/bin/env python3
"""Align two cloud-UI expectations with the offline contract, preserving local persistence assertions."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
file = ROOT / 'packages/insomnia-smoke-test/tests/smoke/preferences-interactions.test.ts'
text = file.read_text(encoding='utf-8')
start = text.index("test('AI URL settings persist advanced options'")
end = text.index('// Quick reproduction for Kong/insomnia#5664', start)
replacement = '''// AI cloud UI is intentionally disabled. Its local configuration store remains
// editable through the typed API, and must retain its data without contacting a model.
test('AI URL configuration persists locally while cloud UI stays disabled', async ({ page }) => {
  const expected = {
    url: 'https://llm.local/v1', model: 'gpt-4o-mini', apiKey: 'persisted-token',
    temperature: 0.7, topP: 0.95, maxTokens: 4096,
  };
  await page.evaluate(async config => {
    await window.main.llm.updateBackendConfig('url', config);
    await window.main.llm.setActiveBackend('url');
  }, expected);
  await page.reload();
  await page.getByTestId('offline-mode').waitFor({ state: 'visible' });
  await page.getByTestId('settings-button').click();
  await page.getByTestId('preference-modal').waitFor({ state: 'visible' });
  await expect(page.getByRole('tab', { name: 'AI Settings' })).toHaveCount(0);
  const config = await page.evaluate(() => window.main.llm.getBackendConfig('url'));
  expect(config).toMatchObject({ backend: 'url', ...expected });
  const session = await page.evaluate(() => window._dataServicesInvoke('userSession', 'get'));
  expect(session.id).toBe('');
});

test('AI URL deactivation preserves the local configuration without enabling cloud UI', async ({ page }) => {
  const expected = {
    url: 'https://llm-deactivate.local/v1', model: 'gpt-4o-mini', apiKey: 'activation-token',
    temperature: 0.6, topP: 0.9, maxTokens: 8192,
  };
  await page.evaluate(async config => {
    await window.main.llm.updateBackendConfig('url', config);
    await window.main.llm.setActiveBackend('url');
  }, expected);
  expect(await page.evaluate(() => window.main.llm.getActiveBackend())).toBe('url');
  await page.evaluate(() => window.main.llm.setActiveBackend(null));
  await page.reload();
  await page.getByTestId('offline-mode').waitFor({ state: 'visible' });
  await page.getByTestId('settings-button').click();
  await expect(page.getByRole('tab', { name: 'AI Settings' })).toHaveCount(0);
  const [activeBackend, config] = await page.evaluate(async () => [
    await window.main.llm.getActiveBackend(), await window.main.llm.getBackendConfig('url'),
  ] as const);
  expect(activeBackend).toBeNull();
  expect(config).toMatchObject({ backend: 'url', ...expected });
});

'''
file.write_text(text[:start] + replacement + text[end:], encoding='utf-8', newline='\n')
print(file.relative_to(ROOT))
