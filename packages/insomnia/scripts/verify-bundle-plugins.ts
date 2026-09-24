import fs from 'node:fs';
import path from 'node:path';

import { bundlePlugins } from '../config/config.json';

// Offline plugins are checked-in sources statically imported by offline-plugins.ts.
// Never resolve npm packages or fetch a plugin while installing/building the app.
export const verifyBundlePlugins = () => {
  const root = path.resolve(__dirname, '../src/vendor');
  for (const { name } of bundlePlugins) {
    if (!/^insomnia-plugin-[a-z0-9-]+$/.test(name)) throw new Error('Invalid bundled plugin name');
    const directory = path.join(root, name);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (metadata.name !== name || Object.keys(metadata.dependencies ?? {}).length > 0) {
      throw new Error(`Offline plugin ${name} has unresolved runtime dependencies`);
    }
    const entry = path.resolve(directory, metadata.main);
    if (!entry.startsWith(directory + path.sep) || !fs.statSync(entry).isFile()) {
      throw new Error(`Offline plugin entry is missing: ${name}`);
    }
  }
  console.log('[offline] Bundled plugin sources are present; no plugin downloads needed.');
};

verifyBundlePlugins();
