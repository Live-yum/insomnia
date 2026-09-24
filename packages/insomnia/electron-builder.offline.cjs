/* global require, module */
const base = require('./electron-builder.config.js');

/** Portable review builds. Preserve the upstream executable name so its Windows
 * secure wrapper remains applicable. The UI and data directory use Offline branding.
 * No signing credentials are assumed and no update metadata/feed is published.
 * Icons are committed resources, never vendor URLs. Linux can convert the local ICNS.
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  ...base,
  appId: 'com.liveyum.insomnia.offline',
  publish: null,
  icon: './src/icons/icon.ico',
  directories: { ...base.directories, buildResources: './src/icons' },
  protocols: [{ name: 'Insomnia Offline', role: 'Viewer', schemes: ['insomnia-offline'] }],
  extraMetadata: { ...base.extraMetadata, offlineBuild: true },
  extraResources: [
    { from: './offline-plugin-resources', to: 'offline-plugins', filter: ['**/*'] },
    { from: '../../vendor/offline-plugins/REPORT.md', to: 'OFFLINE-PLUGIN-REPORT.md' },
    { from: '../../vendor/offline-plugins/EXCEPTIONS.json', to: 'OFFLINE-PLUGIN-EXCEPTIONS.json' },
    { from: '../../docs/OFFLINE-PLUGINS.md', to: 'OFFLINE-PLUGINS.md' },
  ],
  mac: { ...base.mac, icon: './src/icons/icon.icns' },
  win: {
    ...base.win,
    icon: './src/icons/icon.ico',
    target: [{ target: 'zip', arch: ['x64'] }],
    publish: null,
    generateUpdatesFilesForAllChannels: false,
    artifactName: 'Insomnia-Offline-${version}-windows-x64.${ext}',
  },
  linux: {
    ...base.linux,
    icon: './src/icons/icon.icns',
    target: [{ target: 'tar.gz', arch: ['arm64'] }],
    synopsis: 'Local-only API client with vendored plugin profiles',
    artifactName: 'Insomnia-Offline-${version}-linux-arm64.${ext}',
  },
};
