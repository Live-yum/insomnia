const base = require('./electron-builder.config.js');

/** Portable review builds. Preserve the upstream executable name so its Windows
 * secure wrapper remains applicable. The UI and data directory use Offline branding.
 * No signing credentials are assumed and no update metadata/feed is published.
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  ...base,
  appId: 'com.liveyum.insomnia.offline',
  publish: null,
  protocols: [{ name: 'Insomnia Offline', role: 'Viewer', schemes: ['insomnia-offline'] }],
  extraMetadata: { ...base.extraMetadata, offlineBuild: true },
  extraResources: [
    { from: './offline-plugin-resources', to: 'offline-plugins', filter: ['**/*'] },
    { from: '../../vendor/offline-plugins/REPORT.md', to: 'OFFLINE-PLUGIN-REPORT.md' },
    { from: '../../vendor/offline-plugins/EXCEPTIONS.json', to: 'OFFLINE-PLUGIN-EXCEPTIONS.json' },
    { from: '../../docs/OFFLINE-PLUGINS.md', to: 'OFFLINE-PLUGINS.md' },
  ],
  win: {
    ...base.win,
    target: [{ target: 'zip', arch: ['x64'] }],
    publish: null,
    generateUpdatesFilesForAllChannels: false,
    artifactName: 'Insomnia-Offline-${version}-windows-x64.${ext}',
  },
  linux: {
    ...base.linux,
    target: [{ target: 'tar.gz', arch: ['arm64'] }],
    synopsis: 'Local-only API client with vendored plugin profiles',
    artifactName: 'Insomnia-Offline-${version}-linux-arm64.${ext}',
  },
};
