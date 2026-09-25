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
# Wrapping HTML labels can include selected options or textarea text in their
# computed names. Explicit names match visible labels and remain stable on edits.
changes = [
    ('<select className={controlClass} value={value}', '<select aria-label={label} className={controlClass} value={value}'),
    ('<select className={controlClass} value={action}', '<select aria-label={t(\'操作类别\', \'Operation category\')} className={controlClass} value={action}'),
    ('value={input}', "aria-label={action === 'jwt' && operation === 'sign' ? t('JWT 声明（JSON 对象）', 'JWT claims (JSON object)') : t('输入正文', 'Input')} value={input}"),
]
for name, zh, en in [
    ('key', '密钥（仅保存在本次窗口内存中）', 'Key (kept only in this form memory)'),
    ('iv', 'IV / Nonce（Hex；加密时留空自动生成）', 'IV / nonce (hex; leave empty to generate on encryption)'),
    ('tag', '认证标签（解密必填，Hex）', 'Authentication tag (hex; required to decrypt)'),
    ('signature', '签名（Base64）', 'Signature (Base64)'),
    ('passphrase', '私钥口令（可选）', 'Private key passphrase (optional)'),
    ('issuer', '期望签发者 iss（可选）', 'Expected issuer (optional)'),
    ('audience', '期望受众 aud（可选）', 'Expected audience (optional)'),
    ('result', '结果（可能包含明文或私钥，请妥善处理）', 'Result (may contain plaintext or private keys)'),
]:
    before = 'value={' + name + '}'
    changes.append((before, f"aria-label={{t('{zh}', '{en}')}} " + before))
replace('packages/insomnia/src/ui/components/offline-crypto-workbench.tsx', changes)
