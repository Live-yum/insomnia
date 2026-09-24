/** Offline distribution: no installer, updater feed, cloud signing hook, or registration. */
module.exports = {
  appId: 'local.liveyum.insomnia.offline',
  productName: 'Insomnia Offline',
  npmRebuild: false,
  publish: null,
  directories: { output: 'dist-offline', buildResources: 'src/icons' },
  files: [{ from: './build', to: '.', filter: ['**/*', '!**/*.map'] }, './package.json'],
  asarUnpack: ['**/*.node', '**/*.dll', '**/*.so*'],
  extraMetadata: { main: 'entry.main.min.js' },
  win: { target: [{ target: 'dir', arch: ['x64'] }], icon: 'src/icons/icon.ico', signAndEditExecutable: false, publish: null },
  linux: { target: [{ target: 'dir', arch: ['arm64'] }], executableName: 'insomnia-offline', category: 'Development' },
};
