#!/usr/bin/env python3
"""Maintainer-only source acquisition. NEVER invoked by app startup or normal builds.
Fetch pinned, individually hash-checked upstream files; retain attribution and tests.
"""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'packages/insomnia/src/vendor/insomnia-plugin-crypto'
REV = '769994ff8976233ead2e94a9054b3b4a72171485'
FILES = {
    'LICENSE': 'db25a67eda4ce915f8d791964c311e640b0561d5',
    'README.md': 'acdd67a20d2c86a4f58e628cb5d69404f43fafaf',
    'app.js': 'e43c28a44d1760037fe94049e699783d517d0077',
    'encrypt.js': '2e4698c33e0270fec010840e92150e3a7ab79923',
    'store.js': '76b004b1cf76cd3510b688da2d264909dbe9e21c',
    'package.json': 'c899f22f95d38d8e13ef22050e2d96c284591311',
    'assets/icon.svg': '5bfa55f841d88bb14ade7e964764847bb22fc485',
    'test/encrypt.test.js': 'b28259774313245a5cc5e5da90e0d5a1241f0b74',
    'test/store.test.js': 'ef19bb6362ec5a280fb7a39d9a3d9d01d72e79c6',
}

def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Upstream patch anchor changed')
    return text.replace(old, new)

def main():
    if DEST.exists():
        raise RuntimeError('Vendored directory already exists; review upgrades explicitly')
    fetched = {}
    for name, expected in FILES.items():
        url = f'https://raw.githubusercontent.com/zaigr/insomnia-plugin-crypto/{REV}/{name}'
        with urllib.request.urlopen(url, timeout=45) as response:
            data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise RuntimeError('Unexpected upstream file size')
        actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if actual != expected:
            raise RuntimeError('Upstream hash mismatch: ' + name)
        fetched[name] = data
    # Keep AES-CBC's upstream wire format, but fail closed rather than returning
    # successfully with the original plaintext when encryption was requested.
    app = fetched['app.js'].decode()
    app = replace_once(app, "        alertOnMissingEnvConfig('Request Encryption Failed', context);\n        return;", "        throw new Error('Encryption required: configure crypto-alg and crypto-key before sending.');")
    app = replace_once(app, "        context.app.alert('Encryption failed:', error.message);", "        throw new Error('Request encryption failed; nothing was sent.', { cause: error });")
    app = replace_once(app, "        alertOnMissingEnvConfig('Response Decryption Failed', context);\n        return;", "        throw new Error('Response decryption requires crypto-alg and crypto-key.');")
    app = replace_once(app, "        context.app.alert('Decryption failed:', error.message);", "        throw new Error('Response decryption failed.', { cause: error });")
    # The native Insomnia request body bridge is text-based. Arbitrary binary via
    # a JS string can be re-encoded as UTF-8, so reject that lossy legacy mode.
    old = "const useBase64 = context.request.getEnvironmentVariable(USE_BASE64) ?? true;"
    if app.count(old) != 2:
        raise RuntimeError('Base64 patch anchor changed')
    app = app.replace(old, "const useBase64 = context.request.getEnvironmentVariable(USE_BASE64) ?? true;\n      if (useBase64 !== true) throw new Error('Offline Crypto requires crypto-base64=true to avoid binary corruption.');")
    fetched['app.js'] = app.encode()
    meta = json.loads(fetched['package.json'])
    meta['version'] = '1.1.1-offline.1'
    meta['scripts'] = {}
    meta.pop('devDependencies', None)
    meta['insomnia']['publisher'].pop('icon', None)
    fetched['package.json'] = (json.dumps(meta, indent=2) + '\n').encode()
    provenance = {
        'upstream': 'https://github.com/zaigr/insomnia-plugin-crypto',
        'revision': REV, 'upstreamVersion': '1.1.1', 'license': 'MIT',
        'runtimeDependencies': ['Node.js crypto', 'Node.js buffer'],
        'upstreamGitBlobs': FILES,
        'patches': ['Fail closed on encryption/decryption errors and missing configuration',
                    'Require Base64 transport to avoid UTF-8 corruption',
                    'Remove remote publisher icon and development install scripts'],
        'sha256': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(fetched.items())},
    }
    for name, data in fetched.items():
        target = DEST / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (DEST / 'UPSTREAM.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    print('Vendored Crypto 1.1.1-offline.1, including license, source, tests and provenance; no npm runtime dependencies.')

if __name__ == '__main__':
    main()
