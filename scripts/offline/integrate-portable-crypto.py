"""One-time reviewed integration into the shared crypto core; exact anchors only."""
from pathlib import Path
root = Path(__file__).resolve().parents[2]
file = root / 'packages/insomnia/src/vendor/insomnia-plugin-offline-crypto-tools/crypto-core.cjs'
text = file.read_text(encoding='utf-8')
def replace(before, after):
    global text
    if after in text and before not in text:
        return
    if text.count(before) != 1:
        raise ValueError('Unexpected crypto source anchor: ' + before[:100])
    text = text.replace(before, after)
replace("const crypto = require('node:crypto');", "const crypto = require('node:crypto');\nconst portable = require('./portable-crypto.cjs');")
replace("if (!crypto.getHashes().includes(algorithm))", "if (!portable.supportsHash(algorithm) && !crypto.getHashes().includes(algorithm))")
replace("if (!crypto.getCiphers().includes(algorithm))", "if (!sm4 && !crypto.getCiphers().includes(algorithm))")
replace("  let tag;\n  try {\n    const cipher", "  let tag;\n  try {\n    if (sm4) {\n      output = portable.sm4Cipher({ key, iv, input, encrypting, mode, padding: options.padding || 'pkcs7' });\n    } else {\n    const cipher")
replace("    if (mode === 'gcm' && encrypting) tag = cipher.getAuthTag();\n  } catch", "    if (mode === 'gcm' && encrypting) tag = cipher.getAuthTag();\n    }\n  } catch")
replace("  const kind = options.algorithm || 'aes-256';", "  const kind = options.algorithm || 'aes-256';\n  if (kind === 'sm2') return portable.generateSm2();")
replace("    case 'rsa': { return oaep(options); }", "    case 'rsa': { return oaep(options); }\n    case 'sm2': { return portable.sm2Operation(options, decode, encode); }")
replace("crypto.createHash(algorithm).update(decode(options.input ?? '', options.inputEncoding || 'utf8')).digest()", "hashBytes(algorithm, decode(options.input ?? '', options.inputEncoding || 'utf8'))")
replace("crypto.createHmac(algorithm, key).update(decode(options.input ?? '', options.inputEncoding || 'utf8')).digest()", "macBytes(algorithm, key, decode(options.input ?? '', options.inputEncoding || 'utf8'))")
replace("async function execute(options) {", "function hashBytes(algorithm, bytes) {\n  return portable.supportsHash(algorithm) ? portable.digest(algorithm, bytes) : crypto.createHash(algorithm).update(bytes).digest();\n}\nfunction macBytes(algorithm, key, bytes) {\n  return portable.supportsHash(algorithm) ? portable.mac(algorithm, key, bytes) : crypto.createHmac(algorithm, key).update(bytes).digest();\n}\nasync function execute(options) {")
file.write_text(text, encoding='utf-8', newline='\n')
print(file.relative_to(root))
