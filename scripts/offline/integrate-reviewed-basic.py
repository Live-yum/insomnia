#!/usr/bin/env python3
"""Integrate reviewed local-data/security fixes without replacing newer compact/crypto code."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASE = 'ee36859e03b411201c2707bab7214146b9107291'
REVIEWED = '2039c1f868fbba909af009f339213023f3653360'
PREFIXES = ['packages/insomnia/src/', 'packages/insomnia-smoke-test/', 'packages/insomnia-data/src/models/user-session.ts']

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

for sha in (BASE, REVIEWED):
    subprocess.run(['git', 'fetch', '--no-tags', '--depth=1', 'origin', sha], cwd=ROOT, check=True)
names = git('diff', '--name-only', BASE, REVIEWED, '--', *PREFIXES).decode().splitlines()
assert names and all(name.startswith(tuple(PREFIXES)) and name.endswith(('.ts', '.tsx')) for name in names)
patch = git('diff', '--binary', BASE, REVIEWED, '--', *names)
subprocess.run(['git', 'apply', '--3way', '--index', '-'], cwd=ROOT, input=patch, check=True)
assert not git('ls-files', '-u'), 'Resolve source conflicts; never select one whole branch silently'
keyring = ROOT / 'scripts/offline/run-with-ci-keyring.sh'
keyring.write_bytes(git('show', REVIEWED + ':scripts/offline/run-with-ci-keyring.sh'))
keyring.chmod(0o755)
changed = set(names) | {'scripts/offline/run-with-ci-keyring.sh'}

def replace(name, before, after, count=1):
    file = ROOT / name
    text = file.read_text(encoding='utf-8')
    if before not in text and after in text:
        return
    if text.count(before) != count:
        raise ValueError(f'Unexpected reviewed anchor in {name}: expected {count}, got {text.count(before)}')
    file.write_text(text.replace(before, after), encoding='utf-8', newline='\n')
    changed.add(name)

# RAC preselects the actual default branch after the remote list arrives and
# remounts its combobox. Do not toggle the popup on a stale, disabled instance.
# Assert the submitted FormData too, not only the text shown in the input.
page = 'packages/insomnia-smoke-test/playwright/pages/project/index.ts'
replace(page, "    await this.page.getByRole('combobox', { name: 'Search branches Branch' }).press('ArrowDown');\n    await this.page.getByRole('option', { name: 'master', exact: true }).click();", "    await expect(this.page.getByRole('combobox', { name: 'Search branches Branch' })).toBeEnabled();\n    await expect(this.page.getByRole('combobox', { name: 'Search branches Branch' })).toHaveValue('master');\n    await expect.poll(() => this.page.getByRole('form', { name: 'Git Setup Form' }).evaluate(form => new FormData(form as HTMLFormElement).get('branch'))).toBe('master');", 2)
replace('packages/insomnia-smoke-test/tests/smoke/external-vault-integration.test.ts', "page.getByTestId('import-from-clipboard')", "page.locator('[data-test-id=\"import-from-clipboard\"]')")

# Native protection is exercised with a real ephemeral OS keyring on Linux.
# The production app continues to reject plaintext fallback when one is absent.
e2e = '.github/workflows/test-e2e.yml'
replace(e2e, '      - name: Download the lockfile-selected Electron binary before sandbox configuration', '''      - name: Install the real disposable test keyring prerequisites
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y gnome-keyring libsecret-tools libsecret-1-0 dbus-x11 xvfb xauth
      - name: Download the lockfile-selected Electron binary before sandbox configuration''')
replace(e2e, 'npm run test:build -w packages/insomnia-smoke-test -- --project=Smoke --shard="$SHARD_INDEX/$SHARD_TOTAL"', 'dbus-run-session -- bash scripts/offline/run-with-ci-keyring.sh npm run test:build -w packages/insomnia-smoke-test -- --shard="$SHARD_INDEX/$SHARD_TOTAL" --retries=0')
replace('.github/workflows/test.yml', '      - name: Unit Tests\n        run: npm test', '      - name: Prepare pinned Electron before parallel unit imports\n        uses: ./.github/actions/prepare-electron\n\n      - name: Unit Tests\n        run: npm test')
build = '.github/workflows/offline-complete-build.yml'
replace(build, 'libcurl4-openssl-dev xvfb xauth', 'libcurl4-openssl-dev xvfb xauth gnome-keyring libsecret-tools dbus-x11')
replace(build, '--directory "$PACKAGE_DIRECTORY" > /dev/null --target', '--directory "$PACKAGE_DIRECTORY" --target')
replace(build, '        run: bash scripts/offline/run-critical-tests.sh', '''        run: |
          if [ "$RUNNER_OS" = Linux ]; then
            dbus-run-session -- bash scripts/offline/run-with-ci-keyring.sh bash scripts/offline/run-critical-tests.sh
          else
            bash scripts/offline/run-critical-tests.sh
          fi''')
replace(build, 'xvfb-run -a node scripts/offline/run-crypto-acceptance.mjs', 'dbus-run-session -- bash scripts/offline/run-with-ci-keyring.sh xvfb-run -a node scripts/offline/run-crypto-acceptance.mjs')
replace(build, 'run: bash scripts/offline/smoke-linux.sh >', 'run: dbus-run-session -- bash scripts/offline/run-with-ci-keyring.sh bash scripts/offline/smoke-linux.sh >')
# Cryptographic provenance and cross-runtime cases are regular required tests,
# not a one-time evidence file that goes stale after source edits.
replace(build, 'scripts/offline/crypto-core.test.cjs scripts/offline/policy.test.mjs', 'scripts/offline/crypto-core.test.cjs scripts/offline/portable-crypto.test.cjs scripts/offline/policy.test.mjs', 2)
subprocess.run(['git', 'add', '--', *sorted(changed)], cwd=ROOT, check=True)
print('\n'.join(sorted(changed)))
