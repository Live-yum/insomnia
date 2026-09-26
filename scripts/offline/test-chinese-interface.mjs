import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron, expect } from '@playwright/test';

const appRoot = path.resolve('packages/insomnia');
const require = createRequire(path.join(appRoot, 'package.json'));
const executablePath = process.env.INSOMNIA_OFFLINE_SMOKE_EXE || require('electron');
const packaged = !!process.env.INSOMNIA_OFFLINE_SMOKE_EXE;
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'insomnia-zh-cn-'));
const env = { ...process.env, NODE_ENV: 'production', INSOMNIA_OFFLINE_DATA_PATH: profile, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };
for (const key of ['INSOMNIA_DATA_PATH', 'INSOMNIA_SESSION', 'INSOMNIA_OFFLINE_PLUGIN_DIR', 'ELECTRON_RUN_AS_NODE', 'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'INSOMNIA_OFFLINE_BROWSER_ORIGINS']) delete env[key];
let app;
let page;
const launch = async () => {
  app = await electron.launch({ cwd: appRoot, executablePath: path.resolve(executablePath), args: packaged ? [] : ['build/entry.main.min.js'], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await page.getByTestId('offline-mode').waitFor();
};
const openPreferences = async () => {
  await page.getByTestId('settings-button').click();
  await page.getByTestId('offline-interface-language').waitFor();
};
try {
  await launch();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeVisible();
  assert.match(await app.evaluate(({ app }) => app.getLocale()), /^zh(?:-|$)/);
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建或修改', exact: true });
  await dialog.getByRole('textbox', { name: '项目名称', exact: true }).fill('Send Body Password — 用户原始名称');
  await dialog.locator('[aria-label="Project Type Item: local"]').click();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await page.waitForURL(/\/organization\/org_offline\/project\/[^/]+/);
  await dialog.waitFor({ state: 'hidden' });
  await expect(page.getByRole('button', { name: '创建请求集合', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '创建 API 文档', exact: true })).toBeVisible();
  const data = await page.evaluate(() => window._dataServicesInvoke('project', 'list'));
  assert.ok(data.some(project => project.name === 'Send Body Password — 用户原始名称'));
  await openPreferences();
  await expect(page.getByRole('heading', { name: '应用', exact: true })).toBeVisible();
  await expect(page.getByLabel('显示密码', { exact: true })).toBeVisible();
  await page.getByTestId('offline-interface-language').selectOption('en-US');
  await expect(page.getByRole('status')).toContainText('Language preference saved.');
  await app.close(); app = null;
  await launch();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.getByRole('button', { name: 'Create new Project', exact: true })).toBeVisible();
  assert.match(await app.evaluate(({ app }) => app.getLocale()), /^en(?:-|$)/);
  await openPreferences();
  await expect(page.getByRole('heading', { name: 'Application', exact: true })).toBeVisible();
  await page.getByTestId('offline-interface-language').selectOption('zh-CN');
  await expect(page.getByRole('status')).toContainText('语言设置已保存');
  await app.close(); app = null;
  await launch();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeVisible();
  assert.ok((await page.evaluate(() => window._dataServicesInvoke('project', 'list'))).some(project => project.name === 'Send Body Password — 用户原始名称'));
  await fs.mkdir('offline-test-results', { recursive: true });
  const report = {
    status: 'passed', packaged, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    target: `${process.platform}-${process.arch}`, chineseDefaultOnEnglishSystem: true,
    chineseProjectCreation: true, chineseApplicationSettings: true, nativeEngineLocale: true,
    englishPreferencePersistedAcrossRestart: true, chinesePreferencePersistedAcrossRestart: true,
    authoredUserDataPreserved: true,
  };
  await fs.writeFile('offline-test-results/chinese-interface.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  await fs.mkdir('offline-test-results', { recursive: true });
  if (page) {
    await page.screenshot({ path: 'offline-test-results/zh-cn-failure.png' }).catch(() => {});
    await fs.writeFile('offline-test-results/zh-cn-page.txt', await page.content()).catch(() => {});
  }
  throw error;
} finally {
  if (app) await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
