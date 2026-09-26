import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { expect, it } from 'vitest';

it('executes unchanged upstream Mocha cases and offline crypto/policy regressions with their compatible adapter', () => {
  const root = path.resolve(__dirname, '../../../../..');
  const output = execFileSync(process.execPath, [
    '--experimental-strip-types',
    '--test',
    '--test-reporter=tap',
    'scripts/offline/crypto.test.cjs',
    'scripts/offline/policy.test.mjs',
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  expect(output).toContain('# tests 100');
  expect(output).toContain('# pass 100');
  expect(output).toContain('# fail 0');
}, 35_000);
