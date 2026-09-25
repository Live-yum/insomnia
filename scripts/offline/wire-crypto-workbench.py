#!/usr/bin/env python3
"""One-time, exact-anchor UI wiring; reviewed changes are committed before final builds."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace(relative, changes):
    file = ROOT / relative
    text = file.read_text(encoding='utf-8')
    for before, after in changes:
        if after in text:
            continue
        if text.count(before) != 1:
            raise RuntimeError('UI anchor changed in ' + relative + ': ' + before)
        text = text.replace(before, after)
    file.write_text(text, encoding='utf-8', newline='\n')
    print(file.relative_to(ROOT))


replace('packages/insomnia/src/routes/organization.tsx', [
    ("import { Hotkey } from '~/ui/components/hotkey';", "import { Hotkey } from '~/ui/components/hotkey';\nimport { OfflineCryptoWorkbench } from '~/ui/components/offline-crypto-workbench';"),
    ('                    <div className="flex shrink grow basis-1/3 justify-end">', '                    {OFFLINE_BUILD && <OfflineCryptoWorkbench />}\n                    <div className="flex shrink grow basis-1/3 justify-end">'),
])
# A wrapping HTML label otherwise includes option text in its computed label.
# Give the actual input the same explicit localized label that users see.
replace('packages/insomnia/src/ui/components/offline-crypto-workbench.tsx', [
    ('<select className={controlClass} value={value}', '<select aria-label={label} className={controlClass} value={value}'),
    ('<select className={controlClass} value={action}', '<select aria-label={t(\'操作类别\', \'Operation category\')} className={controlClass} value={action}'),
])
