#!/usr/bin/env python3
"""Apply reviewed selector-only repairs; never skip or suppress a test assertion."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SMOKE = ROOT / 'packages/insomnia-smoke-test/tests/smoke'
changed = []


def edit(file, replacements):
    text = file.read_text(encoding='utf-8')
    before = text
    for old, new in replacements:
        if old not in text:
            if new in text:
                continue
            raise ValueError(f'Review anchor changed: {file}: {old}')
        text = text.replace(old, new)
    if text != before:
        file.write_text(text, encoding='utf-8', newline='\n')
        changed.append(str(file.relative_to(ROOT)))


for name in ['insomnia-vault', 'pre-request-script-features', 'preferences-interactions', 'sidebar-focus-onboarding']:
    edit(SMOKE / (name + '.test.ts'), [
        ("page.locator('text=Insomnia Preferences').first().click()",
         "page.getByTestId('preference-modal').waitFor({ state: 'visible' })"),
    ])

for name in ['socket-io', 'websocket']:
    edit(SMOKE / (name + '.test.ts'), [
        ('page.getByText("Disconnect").click()',
         "page.getByRole('button', { name: 'Disconnect', exact: true }).click()"),
    ])

edit(SMOKE / 'grpc-interactions.test.ts', [
    ('page.getByText("Start").click()', "page.getByRole('button', { name: 'Start', exact: true }).click()"),
])
edit(SMOKE / 'export-openapi-spec.test.ts', [
    ("page.getByText('Use example', { exact: true }).click()", "page.getByText('Use example').click()"),
    ("page.getByText('Pet Store', { exact: true }).click()", "page.getByText('Pet Store').click()"),
])
edit(ROOT / 'packages/insomnia-smoke-test/playwright/pages/project/index.ts', [
    ('getByText(storageTypeNames[storageType]).click()',
     'getByText(storageTypeNames[storageType], { exact: true }).click()'),
])
print('\n'.join(changed))
