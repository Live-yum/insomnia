const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(file, 'utf8');
const root = 'packages/insomnia/src/';
assert(read(root + 'common/offline.ts').includes('export const OFFLINE_BUILD = true;'));
for (const file of ['main/sentry.ts', 'ui/sentry.ts', 'main/analytics.ts', 'ui/hooks/use-cio.tsx']) {
  assert(!/Sentry\.init|new InsomniaAnalytics|AnalyticsBrowser\.load/.test(read(root + file)), `${file} initializes telemetry`);
}
assert(!/electron-updater|autoUpdater|checkForUpdates/.test(read(root + 'main/updates.ts')));
// The denial must still be guarded by immutable OFFLINE_BUILD; formatting may add line breaks.
assert(/if\s*\(OFFLINE_BUILD\)\s*\{?\s*throw new Error\(\s*'Online plugin installation is disabled\./.test(read(root + 'main/install-plugin.ts')));
assert(read(root + 'entry.main.ts').includes("app.setPath('sessionData', dataPath)"));
assert(!read(root + 'entry.main.ts').includes('setAsDefaultProtocolClient('));
assert(read(root + 'main/window-security.ts').includes('nodeIntegration: false'));
assert(read(root + 'main/window-security.ts').includes('contextIsolation: true'));
assert.deepEqual(JSON.parse(read('packages/insomnia/config/config.json')).bundlePlugins, [{ name: 'insomnia-plugin-offline-toolkit' }]);
assert(!read(root + 'ui/vault-key.client.ts').includes("from 'insomnia-api'"));
console.log('Offline source invariants passed.');
