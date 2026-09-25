'use strict';
const fs = require('node:fs');
const path = require('node:path');

const forbiddenComponents = new Set(['offline-plugins', 'offline-plugin-resources']);
const forbiddenNames = new Set(['.git', '.npm', '.cache', 'playwright-report', 'test-results', 'traces']);

// Read package metadata only. Never execute plugins or follow symlinks outside
// the package. Archive compression cannot excuse excessive extracted files.
function inspectDirectory(directory) {
  const root = path.resolve(directory);
  if (!fs.lstatSync(root).isDirectory()) throw new Error('Expected a real package directory');
  const report = { unpackedBytes: 0, fileCount: 0, directoryCount: 0, symlinkCount: 0, forbiddenPaths: [], largestFiles: [], groups: {} };
  const files = [];
  const groups = new Map();
  let visited = 0;
  function walk(current) {
    for (const name of fs.readdirSync(current).sort()) {
      if (++visited > 200000) throw new Error('Package scan entry limit exceeded');
      const absolute = path.join(current, name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const components = relative.split('/');
      const stat = fs.lstatSync(absolute);
      if (components.some(part => forbiddenComponents.has(part) || forbiddenNames.has(part)) || name.endsWith('.map')) {
        if (report.forbiddenPaths.length < 100) report.forbiddenPaths.push(relative);
      }
      if (stat.isSymbolicLink()) {
        report.symlinkCount++;
        const resolved = fs.realpathSync(absolute);
        const target = path.relative(root, resolved);
        if (target === '..' || target.startsWith('..' + path.sep) || path.isAbsolute(target)) {
          throw new Error('Package symlink escapes its root: ' + relative);
        }
      } else if (stat.isDirectory()) {
        report.directoryCount++;
        walk(absolute);
      } else if (stat.isFile()) {
        report.fileCount++;
        report.unpackedBytes += stat.size;
        files.push({ path: relative, bytes: stat.size });
        const group = components.slice(0, 2).join('/');
        groups.set(group, (groups.get(group) || 0) + stat.size);
      } else {
        throw new Error('Unsupported packaged filesystem entry: ' + relative);
      }
    }
  }
  walk(root);
  report.largestFiles = files.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)).slice(0, 30);
  report.groups = Object.fromEntries([...groups.entries()].sort((a, b) => b[1] - a[1]));
  return report;
}

function directoryViolations(report, budget) {
  const errors = [];
  for (const [field, limit] of [['unpackedBytes', 'unpackedMaxBytes'], ['fileCount', 'fileCountMax'], ['directoryCount', 'directoryCountMax']]) {
    if (!Number.isSafeInteger(budget[limit]) || budget[limit] <= 0) throw new Error('Invalid budget: ' + limit);
    if (!Number.isSafeInteger(report[field]) || report[field] < 0) throw new Error('Invalid measurement: ' + field);
    if (report[field] > budget[limit]) errors.push(field + '=' + report[field] + ' exceeds ' + budget[limit]);
  }
  if (report.forbiddenPaths.length) errors.push('Unwanted catalog, build diagnostics or source maps are packaged');
  return errors;
}

function inspectArchive(filename, budget) {
  if (!Number.isSafeInteger(budget.archiveMaxBytes) || budget.archiveMaxBytes <= 0) throw new Error('Invalid archive budget');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size === 0) throw new Error('Expected a non-empty regular archive');
  return { archiveBytes: stat.size, violations: stat.size > budget.archiveMaxBytes ? ['archiveBytes=' + stat.size + ' exceeds ' + budget.archiveMaxBytes] : [] };
}

module.exports = { inspectDirectory, directoryViolations, inspectArchive };

if (require.main === module) {
  const [kind, input] = process.argv.slice(2);
  const profile = require('../../packages/insomnia/config/offline-basic.json');
  if (!input || !['directory', 'archive'].includes(kind)) throw new Error('Usage: node basic-budget.cjs directory|archive PATH');
  const report = kind === 'archive' ? inspectArchive(input, profile.budget) : inspectDirectory(input);
  if (kind === 'directory') report.violations = directoryViolations(report, profile.budget);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.violations.length ? 1 : 0;
}
