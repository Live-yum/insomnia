#!/usr/bin/env python3
"""One-time, exact-anchor UI wiring; reviewed changes are committed before final builds."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
file = ROOT / 'packages/insomnia/src/routes/organization.tsx'
text = file.read_text(encoding='utf-8')
changes = [
    ("import { Hotkey } from '~/ui/components/hotkey';", "import { Hotkey } from '~/ui/components/hotkey';\nimport { OfflineCryptoWorkbench } from '~/ui/components/offline-crypto-workbench';"),
    ('                    <div className="flex shrink grow basis-1/3 justify-end">', '                    {OFFLINE_BUILD && <OfflineCryptoWorkbench />}\n                    <div className="flex shrink grow basis-1/3 justify-end">'),
]
for before, after in changes:
    if after in text:
        continue
    if text.count(before) != 1:
        raise RuntimeError('UI anchor changed: ' + before)
    text = text.replace(before, after)
file.write_text(text, encoding='utf-8', newline='\n')
print(file.relative_to(ROOT))
