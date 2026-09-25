"""Reviewed locale wiring; UI source literals are migrated by the typed JSX transformer."""
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
subprocess.run(['git', 'fetch', '--no-tags', '--depth=1', 'origin', '61cb41c988e71a17ddff2fc3704d73a723b71b3e'], cwd=ROOT, check=True)


def replace(name, before, after, count=1):
    path = ROOT / name
    text = path.read_text(encoding='utf-8')
    if before not in text and after in text:
        return
    assert text.count(before) == count, (name, text.count(before), before[:80])
    path.write_text(text.replace(before, after), encoding='utf-8', newline='\n')


# Canonicalize repeated identical glossary entries; refuse conflicting translations.
def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result or result[key] == value, key
        result[key] = value
    return result


file = ROOT / 'packages/insomnia/src/common/offline-ui-translations.json'
glossary = json.loads(file.read_text(encoding='utf-8'), object_pairs_hook=unique_pairs)
glossary['Headers'] = '标头'
file.write_text(json.dumps(glossary, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')

app = 'packages/insomnia/src/'
replace(app + 'ui/components/settings/general.tsx', "import { VaultKeyPanel } from './vault-key-panel';", "import { VaultKeyPanel } from './vault-key-panel';\nimport { OfflineLanguageSettings } from './offline-language';")
replace(app + 'ui/components/settings/general.tsx', '<div className="relative p-4">', '<div className="relative p-4">\n      <OfflineLanguageSettings />')
replace(app + 'entry.main.ts', "import { initElectronStorage } from '~/main/electron-storage';", "import { initElectronStorage } from '~/main/electron-storage';\nimport { getNativeOfflineLocale } from '~/main/offline-ui-locale';")
replace(app + 'entry.main.ts', 'initElectronStorage(dataPath);', "initElectronStorage(dataPath);\n// Engine/native controls follow the persisted explicit choice; first launch is zh-CN.\napp.commandLine.appendSwitch('lang', getNativeOfflineLocale());")
replace(app + 'root.tsx', '<html lang="en" className="size-full overflow-hidden">', '<html lang={getOfflineLocale()} suppressHydrationWarning className="size-full overflow-hidden">')
replace(app + 'root.tsx', "import { OFFLINE_BUILD, OFFLINE_ENTRY } from '~/common/offline';", "import { OFFLINE_BUILD, OFFLINE_ENTRY } from '~/common/offline';\nimport { getOfflineLocale } from '~/ui/offline-locale';")
replace(app + 'ui/components/offline-crypto-workbench.tsx', "value => setOfflineLocale(value === 'en-US' ? 'en-US' : 'zh-CN')", "value => { void setOfflineLocale(value === 'en-US' ? 'en-US' : 'zh-CN').catch(() => setError(t('语言设置保存失败，请重试。', 'Language preference could not be saved.'))); }")

# Legacy English UI cases explicitly select English through the real stored
# user preference. A separate fresh-process test checks the default Chinese UI.
launch = 'packages/insomnia-smoke-test/playwright/launch.ts'
replace(launch, '  try {\n', '''  try {
    const languagePage = await app.firstWindow();
    await languagePage.waitForURL(url => url.protocol !== 'about:');
    await languagePage.waitForLoadState('domcontentloaded');
    await languagePage.waitForFunction(() => Boolean(window.main?.electronStorage));
    await languagePage.evaluate(async () => {
      const key = 'insomnia.offline.ui-locale';
      await window.main.electronStorage.setItem(key, 'en-US');
      window.localStorage.setItem(key, 'en-US');
    });
    await languagePage.reload();
''')
smoke = 'scripts/offline/smoke.mjs'
replace(smoke, "  await page.getByTestId('offline-mode').waitFor();\n  assert.match", '''  await page.getByTestId('offline-mode').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await page.getByRole('button', { name: '新建项目', exact: true }).waitFor();
  await page.evaluate(async () => {
    await window.main.electronStorage.setItem('insomnia.offline.ui-locale', 'en-US');
    localStorage.setItem('insomnia.offline.ui-locale', 'en-US');
  });
  await page.reload();
  await page.getByTestId('offline-mode').waitFor();
  assert.match''')
subprocess.run(['node', 'scripts/offline/localize-ui.cjs'], cwd=ROOT, check=True)
subprocess.run(['node', '--test', 'scripts/offline/localize-ui.test.cjs'], cwd=ROOT, check=True)
print('Localized source and explicit language preference wiring complete')
