'use strict';
// SPDX-License-Identifier: Apache-2.0
// One local provider. No filesystem, network, dynamic imports, logging or stored keys.
const crypto = require('node:crypto');
const portable = require('./portable-crypto.cjs');
const { Buffer } = require('node:buffer');
const { TextDecoder } = require('node:util');
const MAX_BYTES = 4 * 1024 * 1024;
const STRONG_HASHES = new Set(['sha224', 'sha256', 'sha384', 'sha512', 'sha3-224', 'sha3-256', 'sha3-384', 'sha3-512', 'sm3']);
const HASH_BYTES = { sha256: 32, sha384: 48, sha512: 64 };
const SIGNATURES = Object.freeze({
  RS256: ['rsa', 'sha256'], RS384: ['rsa', 'sha384'], RS512: ['rsa', 'sha512'],
  PS256: ['rsa-pss', 'sha256'], PS384: ['rsa-pss', 'sha384'], PS512: ['rsa-pss', 'sha512'],
  ES256: ['ec', 'sha256', 'prime256v1'], ES384: ['ec', 'sha384', 'secp384r1'], ES512: ['ec', 'sha512', 'secp521r1'],
  EdDSA: ['ed25519', null],
});

function fail(message) { throw new Error(message); }
function text(value, label, limit = MAX_BYTES * 2) {
  if (typeof value !== 'string' || value.length > limit) fail(label + '：必须是长度受限的字符串 / Expected bounded text');
  return value;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(label + '：必须是 JSON 对象 / Expected JSON object');
  }
  return value;
}
function decode(value, encoding = 'utf8', label = '输入') {
  text(value, label);
  let bytes;
  if (encoding === 'utf8') {
    bytes = Buffer.from(value, 'utf8');
    if (bytes.toString('utf8') !== value) fail(label + '：无效 Unicode / Invalid Unicode');
  } else if (encoding === 'hex') {
    if (value.length % 2 || /[^\da-f]/i.test(value)) fail(label + '：无效 Hex / Invalid hexadecimal');
    bytes = Buffer.from(value, 'hex');
  } else if (encoding === 'base64') {
    if (value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail(label + '：无效 Base64');
    bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64') !== value) fail(label + '：Base64 必须为规范编码 / Non-canonical Base64');
  } else if (encoding === 'base64url') {
    if (value.length % 4 === 1 || /[^A-Za-z0-9_-]/.test(value)) fail(label + '：无效 Base64URL');
    bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) fail(label + '：Base64URL 必须为规范编码 / Non-canonical Base64URL');
  } else {
    fail('不支持的编码 / Unsupported encoding');
  }
  if (bytes.length > MAX_BYTES) fail('单次输入不得超过 4 MiB / Input exceeds 4 MiB');
  return bytes;
}
function encode(bytes, encoding = 'base64') {
  if (encoding === 'utf8') {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('结果不是 UTF-8 文本，请选择 Hex 或 Base64 / Output is not UTF-8'); }
  }
  if (!['hex', 'base64', 'base64url'].includes(encoding)) fail('不支持的输出编码 / Unsupported output encoding');
  return Buffer.from(bytes).toString(encoding);
}
function hashName(algorithm, legacy = false) {
  if (!STRONG_HASHES.has(algorithm) && !(legacy === true && ['md5', 'sha1'].includes(algorithm))) {
    fail('摘要算法不受支持；MD5/SHA-1 仅允许显式旧接口兼容 / Unsupported or legacy hash');
  }
  if (!portable.supportsHash(algorithm) && !crypto.getHashes().includes(algorithm)) fail('当前运行时不支持此摘要 / Hash unavailable in this runtime');
  return algorithm;
}
function readKey(value, privateKey) {
  let options;
  if (typeof value === 'string') {
    options = { key: text(value, 'PEM 密钥', 32_768), format: 'pem' };
  } else {
    object(value, '密钥');
    if (value.format === 'jwk') options = { key: object(value.data, 'JWK'), format: 'jwk' };
    else if (value.format === 'der') options = { key: decode(text(value.data, 'DER 密钥', 32_768), 'base64'), format: 'der', type: privateKey ? 'pkcs8' : 'spki' };
    else if (value.format === 'pem') options = { key: text(value.data, 'PEM 密钥', 32_768), format: 'pem' };
    else fail('密钥格式必须为 PEM、DER 或 JWK / Unsupported key format');
    if (value.passphrase !== undefined) options.passphrase = text(value.passphrase, '私钥口令', 1024);
  }
  try { return privateKey ? crypto.createPrivateKey(options) : crypto.createPublicKey(options); } catch {
    fail(privateKey ? '无法读取私钥或私钥口令错误 / Invalid private key or passphrase' : '无法读取公钥 / Invalid public key');
  }
}
function rsaSize(key) {
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (!['rsa', 'rsa-pss'].includes(key.asymmetricKeyType) || !bits || bits < 2048 || bits > 8192) {
    fail('RSA 密钥必须为 2048–8192 位 / Invalid RSA key size');
  }
  return Math.ceil(bits / 8);
}
function signatureParameters(algorithm, material, signing, format = 'der') {
  if (!Object.hasOwn(SIGNATURES, algorithm)) fail('不支持的签名算法 / Unsupported signature algorithm');
  const [kind, hash, curve] = SIGNATURES[algorithm];
  if (material?.format === 'jwk') {
    const jwk = material.data;
    if ((jwk.alg && jwk.alg !== algorithm) || (jwk.use && jwk.use !== 'sig') ||
        (jwk.key_ops && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes(signing ? 'sign' : 'verify')))) {
      fail('JWK 用途或算法不匹配 / JWK usage or algorithm mismatch');
    }
  }
  const key = readKey(material, signing);
  const options = { key };
  if (kind === 'rsa' || kind === 'rsa-pss') {
    rsaSize(key);
    if (kind === 'rsa' && key.asymmetricKeyType !== 'rsa') fail('RSA 密钥类型不匹配 / RSA key type mismatch');
    options.padding = kind === 'rsa' ? crypto.constants.RSA_PKCS1_PADDING : crypto.constants.RSA_PKCS1_PSS_PADDING;
    if (kind === 'rsa-pss') options.saltLength = HASH_BYTES[hash];
  } else if (kind === 'ec') {
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== curve) fail('EC 曲线与签名算法不匹配 / EC curve mismatch');
    if (!['der', 'ieee-p1363'].includes(format)) fail('签名格式必须为 DER 或 IEEE-P1363 / Unsupported signature format');
    options.dsaEncoding = format;
  } else if (key.asymmetricKeyType !== 'ed25519') {
    fail('EdDSA 当前使用 Ed25519 密钥 / Expected Ed25519 key');
  }
  return { hash, options };
}
function signBytes(algorithm, key, bytes, format) {
  const params = signatureParameters(algorithm, key, true, format);
  return crypto.sign(params.hash, bytes, params.options);
}
function verifyBytes(algorithm, key, bytes, signature, format) {
  const params = signatureParameters(algorithm, key, false, format);
  try { return crypto.verify(params.hash, bytes, params.options, signature); } catch { return false; }
}
function symmetric(options) {
  const algorithm = options.algorithm || 'aes-256-gcm';
  const match = /^aes-(128|192|256)-(gcm|cbc|ctr)$/.exec(algorithm);
  const sm4 = ['sm4-cbc', 'sm4-ctr'].includes(algorithm);
  if (!match && !sm4) fail('不支持的对称算法 / Unsupported symmetric algorithm');
  if (!sm4 && !crypto.getCiphers().includes(algorithm)) fail('当前运行时不支持此算法 / Cipher unavailable in this runtime');
  if (!['encrypt', 'decrypt'].includes(options.operation)) fail('请选择加密或解密 / Choose encrypt or decrypt');
  const encrypting = options.operation === 'encrypt';
  const mode = match ? match[2] : algorithm.slice(4);
  const key = decode(options.key, options.keyEncoding || 'hex', '密钥');
  const keyLength = sm4 ? 16 : Number(match[1]) / 8;
  if (key.length !== keyLength) fail('密钥长度不正确 / Invalid key length');
  const ivLength = mode === 'gcm' ? 12 : 16;
  const iv = options.iv === undefined || options.iv === ''
    ? (encrypting ? crypto.randomBytes(ivLength) : fail('解密必须提供 IV / IV is required'))
    : decode(options.iv, options.ivEncoding || 'hex', 'IV');
  if (iv.length !== ivLength) fail('IV 长度不正确 / Invalid IV length');
  if (mode !== 'gcm' && ((options.aad ?? '') !== '' || (options.tag ?? '') !== '')) fail('AAD/Tag 仅用于 GCM / AAD and tag require GCM');
  const input = decode(options.input ?? '', options.inputEncoding || (encrypting ? 'utf8' : 'base64'));
  const outputEncoding = options.outputEncoding || (encrypting ? 'base64' : 'utf8');
  let output;
  let tag;
  try {
    if (sm4) {
      output = portable.sm4Cipher({ key, iv, input, encrypting, mode, padding: options.padding || 'pkcs7' });
    } else {
    const cipher = encrypting
      ? crypto.createCipheriv(algorithm, key, iv, mode === 'gcm' ? { authTagLength: 16 } : undefined)
      : crypto.createDecipheriv(algorithm, key, iv, mode === 'gcm' ? { authTagLength: 16 } : undefined);
    if (mode === 'gcm') {
      cipher.setAAD(decode(options.aad ?? '', options.aadEncoding || 'utf8', 'AAD'));
      if (!encrypting) {
        tag = decode(options.tag, options.tagEncoding || 'hex', '认证标签');
        if (tag.length !== 16) fail('GCM 认证标签必须为 16 字节 / Invalid GCM tag');
        cipher.setAuthTag(tag);
      }
    }
    if (mode === 'cbc') {
      const padding = options.padding || 'pkcs7';
      if (!['pkcs7', 'none'].includes(padding)) fail('不支持的填充 / Unsupported padding');
      cipher.setAutoPadding(padding === 'pkcs7');
    }
    // Do not expose decipher.update() output until final() authenticates/passes padding.
    output = Buffer.concat([cipher.update(input), cipher.final()]);
    if (mode === 'gcm' && encrypting) tag = cipher.getAuthTag();
    }
  } catch {
    fail('加解密失败：请检查密钥、IV、Tag、AAD、长度和填充 / Cipher authentication or parameters failed');
  }
  return { algorithm, output: encode(output, outputEncoding), encoding: outputEncoding, iv: iv.toString('hex'), ivEncoding: 'hex',
    ...(tag ? { tag: tag.toString('hex'), tagEncoding: 'hex' } : {}),
    authenticated: mode === 'gcm',
    ...(mode !== 'gcm' ? { warning: 'CBC/CTR 不提供完整性认证；不要把解密成功当成数据可信 / CBC and CTR are not authenticated' } : {}),
  };
}
function oaep(options) {
  if (!['encrypt', 'decrypt'].includes(options.operation)) fail('请选择加密或解密 / Choose encrypt or decrypt');
  const decrypting = options.operation === 'decrypt';
  const key = readKey(options.key, decrypting);
  const length = rsaSize(key);
  if (key.asymmetricKeyType !== 'rsa') fail('RSA-OAEP 不接受 RSA-PSS 密钥 / Expected RSA encryption key');
  const hash = options.hash || 'sha256';
  if (!Object.hasOwn(HASH_BYTES, hash)) fail('OAEP 仅支持 SHA-256/384/512 / Unsupported OAEP hash');
  const bytes = decode(options.input ?? '', options.inputEncoding || (decrypting ? 'base64' : 'utf8'));
  if ((!decrypting && bytes.length > length - 2 * HASH_BYTES[hash] - 2) || (decrypting && bytes.length !== length)) {
    fail('RSA 输入长度不正确；大数据请使用对称加密 / Invalid RSA input length');
  }
  const params = { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: hash,
    oaepLabel: decode(options.label ?? '', options.labelEncoding || 'utf8', 'OAEP label') };
  let output;
  try { output = decrypting ? crypto.privateDecrypt(params, bytes) : crypto.publicEncrypt(params, bytes); } catch { fail('RSA-OAEP 处理失败 / RSA-OAEP failed'); }
  const encoding = options.outputEncoding || (decrypting ? 'utf8' : 'base64');
  return { output: encode(output, encoding), encoding, algorithm: 'RSA-OAEP-' + hash };
}
function jwtSecret(options, algorithm) {
  const bytes = decode(options.key, options.keyEncoding || 'utf8', 'JWT 对称密钥');
  const size = Number(algorithm.slice(2)) / 8;
  if (bytes.length < size || bytes.toString('utf8').includes('-----BEGIN ')) fail('JWT HMAC 必须使用足够长度的独立对称密钥，不能使用 PEM / Invalid JWT HMAC key');
  return bytes;
}
function jwtAlgorithm(algorithm) {
  if (!['HS256', 'HS384', 'HS512'].includes(algorithm) && !Object.hasOwn(SIGNATURES, algorithm)) {
    fail('必须明确指定允许的 JWT 算法；不支持 none / Explicit supported JWT algorithm required');
  }
  return algorithm;
}
function jwtMac(options, algorithm, bytes) {
  return crypto.createHmac('sha' + algorithm.slice(2), jwtSecret(options, algorithm)).update(bytes).digest();
}
function parseJwt(token) {
  text(token, 'JWT', 1024 * 1024);
  const parts = token.split('.');
  if (parts.length !== 3 || parts.includes('')) fail('JWT 必须为三个非空段 / Expected compact signed JWT');
  let header;
  let payload;
  try {
    header = object(JSON.parse(encode(decode(parts[0], 'base64url'), 'utf8')), 'JWT header');
    payload = object(JSON.parse(encode(decode(parts[1], 'base64url'), 'utf8')), 'JWT payload');
  } catch { fail('JWT header/payload 编码或 JSON 无效 / Invalid JWT encoding or JSON'); }
  const signature = decode(parts[2], 'base64url', 'JWT signature');
  return { parts, header, payload, signature };
}
function validateClaims(payload, options) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.clockTolerance ?? 0;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > 300) fail('JWT 校验时间参数无效 / Invalid JWT time parameters');
  for (const claim of ['exp', 'nbf', 'iat']) {
    if (payload[claim] !== undefined && (typeof payload[claim] !== 'number' || !Number.isFinite(payload[claim]))) fail('JWT 时间声明必须是数值 / Invalid NumericDate');
  }
  if (payload.exp !== undefined && now >= payload.exp + tolerance) fail('JWT 已过期 / JWT expired');
  if (payload.nbf !== undefined && now + tolerance < payload.nbf) fail('JWT 尚未生效 / JWT not yet valid');
  if (options.issuer !== undefined && payload.iss !== text(options.issuer, 'issuer', 4096)) fail('JWT issuer 不匹配 / Issuer mismatch');
  if (options.audience !== undefined) {
    const expected = text(options.audience, 'audience', 4096);
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.every(item => typeof item === 'string') || !audiences.includes(expected)) fail('JWT audience 不匹配 / Audience mismatch');
  }
  const required = options.requiredClaims ?? [];
  if (!Array.isArray(required) || required.length > 20 || required.some(claim => typeof claim !== 'string' || !Object.hasOwn(payload, claim))) {
    fail('JWT 缺少必需声明 / Missing required JWT claim');
  }
  return { expiration: payload.exp === undefined ? 'absent' : 'passed', notBefore: payload.nbf === undefined ? 'absent' : 'passed',
    issuer: options.issuer === undefined ? 'not-requested' : 'passed', audience: options.audience === undefined ? 'not-requested' : 'passed' };
}
function jwt(options) {
  if (options.operation === 'inspect') {
    const parsed = parseJwt(options.input);
    return { header: parsed.header, payload: parsed.payload, signatureVerified: false, warning: '仅解析，未验签 / Inspection is NOT verification' };
  }
  const algorithm = jwtAlgorithm(options.algorithm);
  const isHmac = algorithm.startsWith('HS');
  if (options.operation === 'sign') {
    const claims = object(options.claims, 'JWT claims');
    const header = { typ: 'JWT', alg: algorithm };
    if (options.kid !== undefined) header.kid = text(options.kid, 'kid', 256);
    const headerText = JSON.stringify(header);
    const claimsText = text(JSON.stringify(claims), 'JWT claims', 1024 * 1024);
    const input = Buffer.from(headerText).toString('base64url') + '.' + Buffer.from(claimsText).toString('base64url');
    const bytes = Buffer.from(input, 'ascii');
    const signature = isHmac ? jwtMac(options, algorithm, bytes) : signBytes(algorithm, options.key, bytes, 'ieee-p1363');
    return { output: input + '.' + signature.toString('base64url'), algorithm };
  }
  if (options.operation !== 'verify') fail('JWT 操作必须为 sign、verify 或 inspect / Unsupported JWT operation');
  const { parts, header, payload, signature } = parseJwt(options.input);
  if (header.alg !== algorithm) fail('JWT 算法与允许值不一致 / JWT algorithm mismatch');
  if (Object.hasOwn(header, 'crit') || Object.hasOwn(header, 'b64') || ['jku', 'jwk', 'x5u', 'x5c'].some(name => Object.hasOwn(header, name))) {
    fail('不接受 JWT 内置密钥、远程密钥或未支持扩展 / Unsupported JWT trust metadata or extension');
  }
  const bytes = Buffer.from(parts.slice(0, 2).join('.'), 'ascii');
  let valid;
  if (isHmac) {
    const expected = jwtMac(options, algorithm, bytes);
    valid = signature.length === expected.length && crypto.timingSafeEqual(signature, expected);
  } else {
    valid = verifyBytes(algorithm, options.key, bytes, signature, 'ieee-p1363');
  }
  if (!valid) fail('JWT 签名验证失败 / Invalid JWT signature');
  const claims = validateClaims(payload, options);
  return { signatureVerified: true, header, payload, claims };
}
async function keygen(options) {
  const kind = options.algorithm || 'aes-256';
  if (kind === 'sm2') return portable.generateSm2();
  if (['aes-128', 'aes-192', 'aes-256', 'sm4', 'hmac-sha256', 'hmac-sha384', 'hmac-sha512'].includes(kind)) {
    const size = kind === 'sm4' ? 16 : Number(kind.match(/\d+$/)[0]) / 8;
    const encoding = options.outputEncoding || 'hex';
    return { algorithm: kind, output: encode(crypto.randomBytes(size), encoding), encoding };
  }
  let type;
  let params;
  if (kind === 'rsa') {
    const bits = options.bits ?? 3072;
    if (![2048, 3072, 4096].includes(bits)) fail('请选择 2048、3072 或 4096 位 / Unsupported RSA generation size');
    type = 'rsa'; params = { modulusLength: bits, publicExponent: 65_537 };
  } else if (['ES256', 'ES384', 'ES512'].includes(kind)) {
    type = 'ec'; params = { namedCurve: SIGNATURES[kind][2] };
  } else if (kind === 'EdDSA') {
    type = 'ed25519'; params = {};
  } else { fail('不支持的密钥类型 / Unsupported key type'); }
  const pair = await new Promise((resolve, reject) => crypto.generateKeyPair(type, params, (error, publicKey, privateKey) => {
    if (error) reject(new Error('密钥生成失败 / Key generation failed')); else resolve({ publicKey, privateKey });
  }));
  const format = options.format || 'pem';
  if (!['pem', 'der', 'jwk'].includes(format)) fail('不支持的密钥输出格式 / Unsupported key output format');
  const publicKey = pair.publicKey.export(format === 'jwk' ? { format } : { type: 'spki', format });
  const privateKey = pair.privateKey.export(format === 'jwk' ? { format } : { type: 'pkcs8', format });
  return { algorithm: kind, format, publicKey: format === 'der' ? publicKey.toString('base64') : publicKey,
    privateKey: format === 'der' ? privateKey.toString('base64') : privateKey };
}
function hashBytes(algorithm, bytes) {
  return portable.supportsHash(algorithm) ? portable.digest(algorithm, bytes) : crypto.createHash(algorithm).update(bytes).digest();
}
function macBytes(algorithm, key, bytes) {
  return portable.supportsHash(algorithm) ? portable.mac(algorithm, key, bytes) : crypto.createHmac(algorithm, key).update(bytes).digest();
}
async function execute(options) {
  object(options, '参数');
  if (JSON.stringify(options).length > MAX_BYTES * 2) fail('参数总长度超过限制 / Options exceed size limit');
  switch (options.action) {
    case 'cipher': { return symmetric(options); }
    case 'rsa': { return oaep(options); }
    case 'sm2': { return portable.sm2Operation(options, decode, encode); }
    case 'digest': {
      const algorithm = hashName(options.algorithm || 'sha256', options.legacy);
      const encoding = options.outputEncoding || 'hex';
      return { output: encode(hashBytes(algorithm, decode(options.input ?? '', options.inputEncoding || 'utf8')), encoding), algorithm, encoding,
        ...(['md5', 'sha1'].includes(algorithm) ? { warning: '仅限旧接口兼容，不用于安全认证 / Legacy compatibility only' } : {}) };
    }
    case 'hmac': {
      const algorithm = hashName(options.algorithm || 'sha256');
      const key = decode(options.key, options.keyEncoding || 'utf8', 'MAC 密钥');
      if (!key.length) fail('MAC 密钥不能为空 / MAC key must not be empty');
      const encoding = options.outputEncoding || 'hex';
      return { output: encode(macBytes(algorithm, key, decode(options.input ?? '', options.inputEncoding || 'utf8')), encoding), encoding, algorithm };
    }
    case 'sign': {
      const encoding = options.outputEncoding || 'base64';
      return { output: encode(signBytes(options.algorithm, options.key, decode(options.input ?? '', options.inputEncoding || 'utf8'), options.signatureFormat || 'der'), encoding), encoding, algorithm: options.algorithm };
    }
    case 'verify': {
      return { valid: verifyBytes(options.algorithm, options.key, decode(options.input ?? '', options.inputEncoding || 'utf8'), decode(options.signature, options.signatureEncoding || 'base64', '签名'), options.signatureFormat || 'der'), algorithm: options.algorithm };
    }
    case 'jwt': { return jwt(options); }
    case 'keygen': { return keygen(options); }
    case 'convert': {
      const encoding = options.outputEncoding || 'base64';
      return { output: encode(decode(options.input ?? '', options.inputEncoding || 'utf8'), encoding), encoding };
    }
    case 'random': {
      const size = options.bytes ?? 32;
      if (!Number.isSafeInteger(size) || size < 1 || size > 1024) fail('随机数长度必须为 1–1024 字节 / Invalid random byte count');
      const encoding = options.outputEncoding || 'hex';
      return { output: encode(crypto.randomBytes(size), encoding), encoding };
    }
    default: { fail('不支持的操作 / Unsupported operation'); }
  }
}
module.exports = { execute, decode, encode };
