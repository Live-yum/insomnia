import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from '@playwright/test';

const appRoot = path.resolve('packages/insomnia');
const require = createRequire(path.join(appRoot, 'package.json'));
const executablePath = process.env.INSOMNIA_OFFLINE_SMOKE_EXE || require('electron');
const packaged = !!process.env.INSOMNIA_OFFLINE_SMOKE_EXE;
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'insomnia-crypto-ui-'));
const env = { ...process.env, NODE_ENV: 'production', INSOMNIA_OFFLINE_DATA_PATH: profile };
for (const key of ['INSOMNIA_DATA_PATH', 'INSOMNIA_SESSION', 'INSOMNIA_OFFLINE_PLUGIN_DIR', 'ELECTRON_RUN_AS_NODE', 'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'INSOMNIA_OFFLINE_BROWSER_ORIGINS']) delete env[key];
let app;
let page;
const launch = async () => {
  app = await electron.launch({ cwd: appRoot, executablePath: path.resolve(executablePath), args: packaged ? [] : ['build/entry.main.min.js'], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByTestId('offline-mode').waitFor();
};
try {
  await launch();
  const button = page.getByTestId('offline-crypto-open');
  assert.equal(await button.textContent(), '加解密工具');
  await button.click();
  const dialog = page.getByRole('dialog', { name: '离线加解密工作台' });
  await dialog.waitFor();
  await dialog.getByLabel('操作类别', { exact: true }).selectOption('digest');
  await dialog.getByLabel('输入正文', { exact: true }).fill('abc');
  await dialog.getByTestId('offline-crypto-run').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="offline-crypto-result"]')?.value.includes('ba7816bf'));
  let result = JSON.parse(await dialog.getByTestId('offline-crypto-result').inputValue());
  assert.equal(result.output, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await dialog.getByLabel('操作类别', { exact: true }).selectOption('cipher');
  await dialog.getByLabel('密钥（仅保存在本次窗口内存中）', { exact: true }).fill('12'.repeat(32));
  await dialog.getByLabel('输入正文', { exact: true }).fill('真正的离线加密 🔒');
  await dialog.getByTestId('offline-crypto-run').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="offline-crypto-result"]')?.value.includes('"tag"'));
  result = JSON.parse(await dialog.getByTestId('offline-crypto-result').inputValue());
  assert.equal(result.authenticated, true);
  assert.notEqual(result.output, '真正的离线加密 🔒');
  await dialog.getByLabel('处理方式', { exact: true }).selectOption('decrypt');
  await dialog.getByLabel('输入正文', { exact: true }).fill(result.output);
  await dialog.getByLabel('IV / Nonce（Hex；加密时留空自动生成）', { exact: true }).fill(result.iv);
  await dialog.getByLabel('认证标签（解密必填，Hex）', { exact: true }).fill(result.tag);
  await dialog.getByTestId('offline-crypto-run').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="offline-crypto-result"]')?.value.includes('真正的离线加密'));
  assert.equal(JSON.parse(await dialog.getByTestId('offline-crypto-result').inputValue()).output, '真正的离线加密 🔒');
  await dialog.getByLabel('认证标签（解密必填，Hex）', { exact: true }).fill('00'.repeat(16));
  await dialog.getByTestId('offline-crypto-run').click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByTestId('offline-crypto-result').inputValue(), '');
  await dialog.getByLabel('界面语言 / Interface language', { exact: true }).selectOption('en-US');
  await page.getByRole('heading', { name: 'Offline cryptography workbench' }).waitFor();
  await page.getByRole('button', { name: 'Close cryptography workbench', exact: true }).click();
  await page.getByTestId('offline-crypto-open').click();
  assert.equal(await page.getByLabel('Key (kept only in this form memory)', { exact: true }).inputValue(), '');
  assert.equal(await page.getByTestId('offline-crypto-result').inputValue(), '');
  await app.close(); app = null;
  await launch();
  assert.equal(await page.getByTestId('offline-crypto-open').textContent(), 'Cryptography tools');
  const local = await page.evaluate(() => ({ ...localStorage }));
  assert.equal(local['insomnia.offline.ui-locale'], 'en-US');
  assert.ok(!JSON.stringify(local).includes('12'.repeat(32)));
  await fs.mkdir('offline-test-results', { recursive: true });
  const report = { status: 'passed', packaged, chineseDefaultWorkbench: true, authenticatedDigestBridge: true,
    aesGcmUiRoundtrip: true, tamperedTagRejectedWithoutPlaintext: true, languagePersistedAcrossProcessRestart: true,
    sensitiveFieldsClearedOnClose: true, fullApplicationTranslated: false };
  await fs.writeFile('offline-test-results/crypto-workbench.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await fs.mkdir('offline-test-results', { recursive: true });
  if (page) {
    await page.screenshot({ path: 'offline-test-results/crypto-ui-failure.png' }).catch(() => {});
    await fs.writeFile('offline-test-results/crypto-ui-page.txt', await page.content()).catch(() => {});
  }
  throw error;
} finally {
  if (app) await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
