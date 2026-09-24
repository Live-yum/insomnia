'use strict';
/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.liveyum.insomnia.offline',
  productName: 'Insomnia Offline',
  npmRebuild: false,
  asar: true,
  asarUnpack: ['node_modules/@getinsomnia/node-libcurl/**/*'],
  directories: { output: 'dist' },
  files: [{ from: './build', to: '.', filter: ['**/*', '!**/*.map'] }, './package.json'],
  extraResources: [{ from: './src/vendor', to: './offline-plugins', filter: ['**/*'] }],
  extraMetadata: { main: 'entry.main.min.js' },
  protocols: [{ name: 'Insomnia Offline', role: 'Viewer', schemes: ['insomnia-offline'] }],
  publish: null,
  win: {
    executableName: 'Insomnia',
    target: [{ target: 'zip', arch: ['x64'] }],
    signExecutable: false,
    requestedExecutionLevel: 'asInvoker',
  },
  linux: {
    executableName: 'insomnia',
    target: [{ target: 'tar.gz', arch: ['arm64'] }],
    category: 'Development',
    synopsis: 'Local-only API client for restricted intranets',
  },
};
