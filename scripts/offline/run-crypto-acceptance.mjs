import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from '@playwright/test';
import { verifyCryptoBridge } from './verify-crypto-bridge.mjs';

// UI/restart test has its own clean profile and must pass before the bridge suite.
await import('./test-crypto-workbench.mjs');
const executablePath = process.env.INSOMNIA_OFFLINE_SMOKE_EXE;
if (!executablePath) throw new Error('A packaged executable is required for acceptance');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'insomnia-crypto-bridge-'));
const env = { ...process.env, NODE_ENV: 'production', INSOMNIA_OFFLINE_DATA_PATH: profile };
for (const key of ['INSOMNIA_DATA_PATH', 'INSOMNIA_SESSION', 'INSOMNIA_OFFLINE_PLUGIN_DIR', 'ELECTRON_RUN_AS_NODE',
  'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'INSOMNIA_OFFLINE_BROWSER_ORIGINS']) delete env[key];
let app;
try {
  app = await electron.launch({ executablePath: path.resolve(executablePath), env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.getByTestId('offline-mode').waitFor({ timeout: 30000 });
  const checks = await verifyCryptoBridge(page);
  const ui = JSON.parse(await fs.readFile('offline-test-results/crypto-workbench.json', 'utf8'));
  const report = { ...ui, ...checks, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    target: `${process.platform}-${process.arch}`, status: 'passed' };
  await fs.writeFile('offline-test-results/crypto-workbench.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  if (app) await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
