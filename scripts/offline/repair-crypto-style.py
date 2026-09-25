"""One-time reviewed source/style fixes; generated cryptography is not hand-edited."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
changed = []

def replace(name, before, after, count=1):
    path = ROOT / name
    text = path.read_text(encoding='utf-8')
    if before not in text and after in text:
        return
    assert text.count(before) == count, (name, text.count(before))
    path.write_text(text.replace(before, after), encoding='utf-8', newline='\n')
    changed.append(name)

adapter = 'packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools/portable-crypto.cjs'
replace(adapter, "BigInt('0xfffffffeffffffffffffffffffffffff7203df6b21c6052b53bbf40939d54123')", '0xfffffffeffffffffffffffffffffffff7203df6b21c6052b53bbf40939d54123n')
replace(adapter, 'raw.subarray(65, raw.length - 32)', 'raw.subarray(65, -32)')
replace(adapter, 'input.subarray(65, input.length - 32)', 'input.subarray(65, -32)')
# Minified compiler output must retain its exact source fingerprint; rewriting
# var/bit operations with human-style autofixes is unsafe for crypto. Exempt
# this single generated file from style lint, NOT adapters or security scans.
# Reproduction from the pinned closure and all native/interop tests remain gates.
replace('eslint.config.mjs', "      '**/*.min.js',", "      '**/*.min.js',\n      // Compiler output: byte-for-byte regeneration and native crypto tests are required.\n      'packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools/primitives.generated.cjs',")
test = 'scripts/offline/portable-crypto.test.cjs'
replace(test, "      const bytes = Buffer.from(input, 'hex');", "      const bytes = Buffer.from(input, 'hex');\n      const hmacKey = crypto.randomBytes(32);")
replace(test, "inputEncoding: 'hex', key: 'secret'", "inputEncoding: 'hex', key: hmacKey.toString('hex'), keyEncoding: 'hex'")
replace(test, "crypto.createHmac(algorithm, 'secret')", 'crypto.createHmac(algorithm, hmacKey)')
subprocess.run(['git', 'add', '--', *sorted(set(changed))], cwd=ROOT, check=True)
print('\n'.join(sorted(set(changed))))
