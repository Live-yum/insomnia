#!/usr/bin/env python3
"""Finish the warning inventory found by real, uncached workspace lint.

Only known test interactions, generated wrapper comments and five removed cycle
allowances change. Existing disabled upstream tests remain explicitly documented;
no new skipped test, deleted assertion or additional cycle allowance is introduced.
"""
from pathlib import Path
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / 'packages/insomnia-smoke-test/tests/smoke'


def write(file, text):
    file.write_text(text, encoding='utf-8', newline='\n')


def main():
    subprocess.run([sys.executable, str(ROOT / 'scripts/offline/repair_ci_warnings.py')], cwd=ROOT, check=True)
    subprocess.run(['node', 'scripts/offline/repair_playwright_warnings.mjs'], cwd=ROOT, check=True)
    for name, variable in [('grpc-mtls.test.ts', 'fileChooserPromise'), ('mtls.test.ts', 'fileChooser')]:
        file = TESTS / name
        text = file.read_text(encoding='utf-8')
        pattern = re.compile(r"^  (?:let )?" + variable + r" = page.waitForEvent\('filechooser'\);\n  await ([^\n]+);\n  await \(await " + variable + r"\).setFiles\(([^\n]+)\);", re.MULTILINE)
        matches = list(pattern.finditer(text))
        if matches and len(matches) != 3:
            raise ValueError('Review changed file chooser structure: ' + name)
        for index, match in reversed(list(enumerate(matches))):
            replacement = (
                f"  const [certificateFileChooser{index}] = await Promise.all([\n"
                "    page.waitForEvent('filechooser'),\n"
                f"    {match.group(1)},\n"
                "  ]);\n"
                f"  await certificateFileChooser{index}.setFiles({match.group(2)});"
            )
            text = text[:match.start()] + replacement + text[match.end():]
        if not matches and 'certificateFileChooser0' not in text:
            raise ValueError('Missing reviewed file chooser source: ' + name)
        write(file, text)
    # These two suites were already disabled upstream for a hidden, unfinished
    # experimental feature. Keep that state visible, with a narrowly scoped
    # rationale, rather than deleting the tests or pretending they executed.
    for name in ['quickjs-script-sandbox.test.ts', 'quickjs-sendrequest-bridge.test.ts']:
        file = TESTS / name
        text = file.read_text(encoding='utf-8')
        marker = '// eslint-disable-next-line playwright/no-skipped-test -- Existing upstream INS-3890: the experimental QuickJS setting is hidden; not a new skip.\n'
        if marker not in text:
            if text.count('test.describe.skip(') != 1 or 'TODO(INS-3890)' not in text:
                raise ValueError('Review changed upstream skip: ' + name)
            text = text.replace('test.describe.skip(', marker + 'test.describe.skip(', 1)
        write(file, text)
    # The generated modules export strings; the blanket lint-disable was unused.
    # Change the generator too, preserving every byte of the actual vendor source.
    generator = ROOT / 'packages/insomnia/scripts/sandbox-vendored-lib.ts'
    text = generator.read_text(encoding='utf-8')
    token = '    `/* eslint-disable */`,\n'
    if text.count(token) > 1:
        raise ValueError('Review generator comment')
    write(generator, text.replace(token, '', 1))
    for name in ['ajv', 'uuid']:
        file = ROOT / f'packages/insomnia/src/templating/sandbox/vendored/{name}.generated.ts'
        text = file.read_text(encoding='utf-8')
        lines = text.splitlines(keepends=True)
        if len(lines) < 6 or not lines[0].startswith('// @generated'):
            raise ValueError('Unexpected generated source: ' + name)
        if lines[4].strip() == '/* eslint-disable */':
            del lines[4]
        write(file, ''.join(lines))
    baseline = ROOT / 'scripts/circular-references/known-violations.json'
    record = json.loads(baseline.read_text(encoding='utf-8'))
    prefix = 'packages/insomnia/src/'
    def cycle(*parts):
        return ' -> '.join(prefix + part for part in parts)
    root = 'root.tsx'
    modal = 'ui/components/modals/settings-modal.tsx'
    export = 'ui/components/settings/import-export.tsx'
    account = 'ui/hooks/use-account-server-data.ts'
    removed = {
        cycle(root, modal, 'ui/components/settings/general.tsx', 'ui/components/settings/vault-key-panel.tsx', 'ui/components/modals/input-vault-key-modal.tsx', account),
        cycle(root, modal, export, 'ui/components/modals/import-modal/import-projects-modal.tsx', account),
        cycle(root, modal, export, account),
        cycle(root, modal, export, 'ui/hooks/use-plan.tsx', account),
        cycle(root, 'ui/containers/app-hooks.tsx', 'ui/hooks/use-cio.tsx'),
    }
    present = set(record['insomnia']) & removed
    if present and present != removed:
        raise ValueError('Review partially changed cycle baseline')
    record['insomnia'] = [item for item in record['insomnia'] if item not in removed]
    write(baseline, json.dumps(record, indent=2) + '\n')
    print('Removed obsolete cycle allowances:', len(present), flush=True)
    # Format only files changed by the above narrow migrations, never all source.
    changed = subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT, text=True).splitlines()
    formatted = [name for name in changed if name.endswith(('.ts', '.tsx')) and '.generated.ts' not in name]
    if formatted:
        subprocess.run(['node', 'node_modules/eslint/bin/eslint.js', '--fix', '--max-warnings=0', *formatted], cwd=ROOT, check=True)
    subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
