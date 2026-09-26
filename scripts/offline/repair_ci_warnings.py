#!/usr/bin/env python3
"""Apply reviewed CI warning fixes, without modifying application/plugin code.

The workflow validates the resulting source and exports a patch for review.
No dependency, test assertion, permission or security setting is removed.
"""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / 'packages/insomnia-smoke-test/tests/smoke'
PINS = {
    'actions/upload-artifact': ('043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', 'v7.0.1'),
    'actions/download-artifact': ('3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', 'v8.0.1'),
}
REPLACEMENTS = {
    'graphql.test.ts': [
        ("page.click('a:has-text(\"Query\")')", "page.getByRole('link', { name: 'Query', exact: true }).click()"),
        ("page.click('text=QueryRingBearer >> button')", "page.locator('text=QueryRingBearer >> button').click()"),
        ("page.click('[data-testid=\"request-pane\"] >> text=Send')", "page.getByTestId('request-pane').getByRole('button', { name: 'Send', exact: true }).click()"),
    ],
    'export-openapi-spec.test.ts': [
        ("page.click('text=Use example')", "page.getByText('Use example', { exact: true }).click()"),
        ("page.click('text=Pet Store')", "page.getByText('Pet Store', { exact: true }).click()"),
    ],
    'design-interactions.test.ts': [
        ("page.click('text=New test suite')", "page.getByText('New test suite', { exact: true }).click()"),
    ],
    'dashboard-interactions.test.ts': [
        ("page.click('[role=\"dialog\"] button:has-text(\"Duplicate\")')", "page.getByRole('dialog').getByRole('button', { name: 'Duplicate', exact: true }).click()"),
        ("page.click('text=API CollectionMy API Collectionjust now >> button')", "page.locator('text=API CollectionMy API Collectionjust now >> button').click()"),
    ],
}


def main():
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip():
        raise ValueError('Use a clean source checkout')
    edits = {}
    for file in sorted((ROOT / '.github').rglob('*.yml')) + sorted((ROOT / '.github').rglob('*.yaml')):
        text = file.read_text(encoding='utf-8')
        before = text
        for action, (sha, version) in PINS.items():
            pattern = re.compile(r'(?m)^(\s*(?:-\s*)?uses:\s*)' + re.escape(action) + r'@([^\s#]+)(?:[ \t]*#[^\n]*)?$')
            def replace(match):
                old = match.group(2)
                if not re.fullmatch(r'(?:[0-9a-f]{40}|v[4-8](?:\.[0-9]+){0,2})', old):
                    raise ValueError('Review unfamiliar action version: ' + action + '@' + old)
                return match.group(1) + action + '@' + sha + ' # ' + version + ', Node 24'
            text = pattern.sub(replace, text)
        if text != before:
            edits[file] = text
    for name, replacements in REPLACEMENTS.items():
        file = TESTS / name
        text = file.read_text(encoding='utf-8')
        before = text
        for old, new in replacements:
            if old not in text and new not in text:
                raise ValueError('Review changed locator source: ' + name + ': ' + old)
            text = text.replace(old, new)
        if text != before:
            edits[file] = text
    config = ROOT / 'eslint.config.mjs'
    text = config.read_text(encoding='utf-8')
    anchor = "      'playwright/prefer-native-locators': 'error',"
    rule = "      'playwright/prefer-locator': 'error',"
    if rule not in text:
        if text.count(anchor) != 1:
            raise ValueError('Review Playwright ESLint config before editing')
        edits[config] = text.replace(anchor, rule + '\n' + anchor)
    for file, text in edits.items():
        file.write_text(text, encoding='utf-8', newline='\n')
        print(file.relative_to(ROOT), flush=True)
    # Only formatting/import fixes in the four reviewed test files; no blanket autofix.
    subprocess.run(['node', str(ROOT / 'node_modules/eslint/bin/eslint.js'), '--fix', '--max-warnings=0',
                    *[str(TESTS / name) for name in REPLACEMENTS]], cwd=ROOT, check=True)
    subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)
    print('CI warning migration completed; plugin archives and application code are unchanged.', flush=True)


if __name__ == '__main__':
    main()
