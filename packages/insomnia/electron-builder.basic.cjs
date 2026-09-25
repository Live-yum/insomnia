/* global require, module */
'use strict';
// Compact profile: production code is in ASAR; no community dependency forest.
const fs = require('node:fs');
const path = require('node:path');
const base = require('./electron-builder.offline.cjs');
const profile = require('./config/offline-basic.json');
const { inspectDirectory, directoryViolations } = require('../../scripts/offline/basic-budget.cjs');

/** @type {import('electron-builder').Configuration} */
module.exports = {
  ...base,
  asar: true,
  electronLanguages: profile.engineLocales,
  files: [
    ...base.files,
    {
      from: './src/vendor',
      to: './offline-reviewed-notices',
      filter: ['*/LICENSE', '*/NOTICE', '*/package.json', '*/UPSTREAM.json'],
    },
    { from: './config/offline-basic.json', to: './offline-basic.json' },
  ],
  extraResources: [],
  extraMetadata: {
    ...base.extraMetadata,
    offlineEdition: profile.edition,
    offlineRequestedUiLocale: profile.requestedDefaultUiLocale,
  },
  afterPack: async context => {
    const report = inspectDirectory(context.appOutDir);
    report.edition = profile.edition;
    report.platform = context.electronPlatformName;
    report.arch = context.arch;
    report.violations = directoryViolations(report, profile.budget);
    const output = path.join(context.outDir, 'basic-budget-' + context.electronPlatformName + '-' + context.arch + '.json');
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    if (report.violations.length) {
      throw new Error('Compact package budget failed; inspect ' + output + ': ' + report.violations.join('; '));
    }
  },
};
