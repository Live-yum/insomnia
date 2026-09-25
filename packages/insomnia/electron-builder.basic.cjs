'use strict';
// Compact profile. Retain the historical full configuration for reproducibility,
// but do not treat it as the newly requested default deliverable.
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
  // Both reviewed crypto modules are statically imported by offline-plugins.ts.
  // Put their notices inside app.asar rather than copying another source/test
  // tree outside the archive. Keep required native unpacking from the base.
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
    // Requested UI default only. Translating actual application strings is a
    // separate release gate; including locales does not translate the UI.
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
