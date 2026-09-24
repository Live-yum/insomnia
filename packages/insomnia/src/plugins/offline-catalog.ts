import fs from 'node:fs';
import path from 'node:path';

interface CatalogEntry {
  name: string;
  profile?: string;
  status: string;
}

let catalogDirectories: Map<string, string[]> | undefined;

const contained = (base: string, target: string) => {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/** Read only the root plugin of each isolated npm dependency tree. Dependencies
 * that are themselves plugins must not silently become additional active plugins.
 * Catalog/package JSON is data; no plugin entrypoint is evaluated here.
 */
function readCatalogDirectories(): Map<string, string[]> {
  if (catalogDirectories) return catalogDirectories;
  const directories = new Map<string, string[]>();
  const resources = process.resourcesPath || process.cwd();
  const configured = process.env.INSOMNIA_OFFLINE_PLUGIN_DIR || path.join(resources, 'offline-plugins');
  if (configured.startsWith('\\\\') || configured.startsWith('//')) {
    throw new Error('Offline plugin resources must be on a local filesystem, not a network share.');
  }
  const root = path.resolve(configured);
  const catalogFile = path.join(root, 'catalog.json');
  if (!fs.existsSync(catalogFile)) {
    catalogDirectories = directories;
    return directories;
  }
  const stat = fs.statSync(catalogFile);
  if (stat.size > 8 * 1024 * 1024) throw new Error('Offline plugin catalog exceeds size limit.');
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8')) as { entries?: CatalogEntry[] };
  if (!Array.isArray(catalog.entries) || catalog.entries.length > 5000) {
    throw new Error('Invalid offline plugin catalog.');
  }
  const realRoot = fs.realpathSync(root);
  for (const entry of catalog.entries) {
    if (entry.status !== 'materialized-unreviewed') continue;
    if (
      typeof entry.name !== 'string' ||
      !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(entry.name) ||
      !entry.profile || !/^[0-9a-f]{20}$/.test(entry.profile)
    ) {
      throw new Error('Invalid offline plugin catalog entry.');
    }
    const modulePath = path.join(root, entry.profile, 'node_modules', entry.name);
    if (!contained(realRoot, fs.realpathSync(modulePath))) {
      throw new Error('Offline plugin path escapes its resource directory.');
    }
    const parent = path.dirname(modulePath);
    const names = directories.get(parent) || [];
    names.push(path.basename(modulePath));
    directories.set(parent, names);
  }
  catalogDirectories = directories;
  return directories;
}

export function getOfflinePluginDirectories(): string[] {
  return [...readCatalogDirectories().keys()];
}

export function readPluginDirectory(directory: string): string[] {
  return readCatalogDirectories().get(path.resolve(directory)) || fs.readdirSync(directory);
}

export function resetOfflinePluginCatalogForTests(): void {
  catalogDirectories = undefined;
}
