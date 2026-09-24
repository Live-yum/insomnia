import cryptoPlugin from '../vendor/insomnia-plugin-crypto/app.js';
import cryptoMetadata from '../vendor/insomnia-plugin-crypto/package.json';
import cryptoTools from '../vendor/insomnia-plugin-offline-crypto-tools/index.cjs';
import toolsMetadata from '../vendor/insomnia-plugin-offline-crypto-tools/package.json';
import type { Plugin } from './plugins/types';

// Only these reviewed, statically bundled modules are trusted. An arbitrary name
// supplied by a renderer can NEVER become require(name). User plugin isolation is unchanged.
const registry = new Map<string, { module: Plugin['module']; version: string; displayName: string }>([
  ['insomnia-plugin-crypto', {
    module: cryptoPlugin as unknown as Plugin['module'],
    version: cryptoMetadata.version,
    displayName: 'Crypto (offline, fail-closed)',
  }],
  ['insomnia-plugin-offline-crypto-tools', {
    module: cryptoTools as unknown as Plugin['module'],
    version: toolsMetadata.version,
    displayName: 'Offline Crypto Tools',
  }],
]);

export function getOfflinePlugin(name: string) {
  const plugin = registry.get(name);
  if (!plugin) throw new Error(`Unknown bundled offline plugin: ${name}`);
  return plugin;
}
