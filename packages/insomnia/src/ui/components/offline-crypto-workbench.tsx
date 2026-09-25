import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import { setOfflineLocale, useOfflineLocale } from '~/ui/offline-locale';

const actions = [
  ['cipher', '对称加解密', 'Symmetric encryption'], ['rsa', 'RSA-OAEP 加解密', 'RSA-OAEP'],
  ['sm2', 'SM2 国密加解密 / 签名', 'SM2 encryption / signatures'],
  ['sign', '数字签名', 'Sign'], ['verify', '签名验证', 'Verify signature'], ['jwt', 'JWT 签名与验签', 'JWT'],
  ['digest', '摘要 / Hash', 'Digest / Hash'], ['hmac', '消息认证码 / HMAC', 'HMAC'],
  ['convert', '编码转换', 'Encoding conversion'], ['random', '安全随机数', 'Secure random'], ['keygen', '生成密钥', 'Generate keys'],
];
const signatures = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];
const algorithms: Record<string, string[]> = {
  cipher: ['aes-256-gcm', 'aes-128-gcm', 'aes-192-gcm', 'aes-256-cbc', 'aes-128-cbc', 'aes-192-cbc', 'aes-256-ctr', 'aes-128-ctr', 'aes-192-ctr', 'sm4-cbc', 'sm4-ctr'],
  rsa: ['sha256', 'sha384', 'sha512'], sign: signatures, verify: signatures,
  jwt: ['HS256', 'HS384', 'HS512', ...signatures],
  digest: ['sha256', 'sha384', 'sha512', 'sha224', 'sha3-256', 'sha3-384', 'sha3-512', 'sm3', 'md5', 'sha1'],
  hmac: ['sha256', 'sha384', 'sha512', 'sha3-256', 'sha3-512', 'sm3'],
  keygen: ['aes-256', 'aes-128', 'aes-192', 'sm4', 'sm2', 'hmac-sha256', 'hmac-sha384', 'hmac-sha512', 'rsa', 'ES256', 'ES384', 'ES512', 'EdDSA'],
};
const encodings = ['utf8', 'hex', 'base64', 'base64url'];
const controlClass = 'w-full rounded-sm border border-solid border-(--hl-md) bg-(--color-bg) p-2 text-(--color-font)';

export const OfflineCryptoWorkbench = () => {
  const locale = useOfflineLocale();
  const t = (zh: string, en: string) => locale === 'zh-CN' ? zh : en;
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState('cipher');
  const [algorithm, setAlgorithm] = useState('aes-256-gcm');
  const [operation, setOperation] = useState('encrypt');
  const [input, setInput] = useState('');
  const [key, setKey] = useState('');
  const [keyEncoding, setKeyEncoding] = useState('hex');
  const [keyFormat, setKeyFormat] = useState('pem');
  const [passphrase, setPassphrase] = useState('');
  const [inputEncoding, setInputEncoding] = useState('utf8');
  const [outputEncoding, setOutputEncoding] = useState('base64');
  const [iv, setIv] = useState('');
  const [aad, setAad] = useState('');
  const [tag, setTag] = useState('');
  const [signature, setSignature] = useState('');
  const [signatureFormat, setSignatureFormat] = useState('der');
  const [cipherMode, setCipherMode] = useState('c1c3c2');
  const [userId, setUserId] = useState('1234567812345678');
  const [padding, setPadding] = useState('pkcs7');
  const [issuer, setIssuer] = useState('');
  const [audience, setAudience] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const keyBased = ['cipher', 'rsa', 'sm2', 'sign', 'verify', 'hmac', 'jwt'].includes(action) && !(action === 'jwt' && operation === 'inspect');
  const asymmetric = ['rsa', 'sign', 'verify'].includes(action) || (action === 'jwt' && !algorithm.startsWith('HS'));
  const clear = () => { setInput(''); setKey(''); setPassphrase(''); setResult(''); setError(''); setSignature(''); setIv(''); setAad(''); setTag(''); setShowKey(false); };
  const changeOpen = (value: boolean) => { if (!value) clear(); setOpen(value); };
  const changeAction = (value: string) => {
    setAction(value); setAlgorithm(algorithms[value]?.[0] || ''); setResult(''); setError('');
    setOperation(value === 'jwt' ? 'verify' : 'encrypt'); setSignatureFormat('der');
    setInputEncoding('utf8'); setOutputEncoding(['digest', 'hmac', 'keygen', 'random'].includes(value) ? 'hex' : 'base64');
  };
  const select = (label: string, value: string, values: string[], update: (value: string) => void) => (
    <label className="flex flex-col gap-1">
      <span>{label}</span>
      <select aria-label={label} className={controlClass} value={value} onChange={event => update(event.target.value)}>
        {values.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  );
  const run = async () => {
    setBusy(true); setResult(''); setError('');
    try {
      let material: unknown = key;
      if (asymmetric && keyBased) {
        material = keyFormat === 'jwk' ? { format: 'jwk', data: JSON.parse(key) }
          : { format: keyFormat, data: key, ...(passphrase ? { passphrase } : {}) };
      }
      const options: Record<string, unknown> = {
        action, algorithm, operation, input, inputEncoding, outputEncoding, key: material, keyEncoding,
        signature, signatureEncoding: 'base64', signatureFormat, legacy,
      };
      if (action === 'cipher') {
        options.iv = iv || undefined;
        options.aad = aad;
        options.tag = tag || undefined;
        options.padding = padding;
      }
      if (action === 'sm2') { options.cipherMode = cipherMode; options.userId = userId; }
      if (action === 'rsa') { options.hash = algorithm; options.label = aad; }
      if (action === 'keygen') { options.format = keyFormat; options.bits = 3072; }
      if (action === 'jwt') {
        if (operation === 'sign') options.claims = JSON.parse(input);
        if (issuer) options.issuer = issuer;
        if (audience) options.audience = audience;
      }
      const token = await window.main.templatingDb.getAuthToken();
      const response = await fetch('insomnia-templating-worker-database://plugin.executeBundlePluginTag', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-insomnia-templating-auth': token },
        body: JSON.stringify({ pluginName: 'insomnia-plugin-offline-crypto-tools', tagName: 'offlineCrypto',
          args: [JSON.stringify(options), 'json'], context: { meta: {}, context: {}, renderPurpose: 'preview' } }),
      });
      if (!response.ok) throw new Error(await response.text());
      const value = await response.json();
      setResult(JSON.stringify(JSON.parse(value), null, 2));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('处理失败', 'Operation failed'));
    } finally { setBusy(false); }
  };
  return (
    <>
      <Button data-testid="offline-crypto-open" onPress={() => setOpen(true)} className="rounded-sm border border-solid border-(--hl-md) px-3 py-1 text-sm">
        {t('加解密工具', 'Cryptography tools')}
      </Button>
      <ModalOverlay isOpen={open} onOpenChange={changeOpen} isDismissable={!busy} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <Modal className="max-h-[90vh] w-[min(980px,95vw)] overflow-y-auto rounded-md border border-solid border-(--hl-md) bg-(--color-bg) p-5 text-(--color-font) shadow-xl">
          <Dialog aria-label={t('离线加解密工作台', 'Offline cryptography workbench')} className="flex flex-col gap-4 outline-none">
            <div className="flex items-center justify-between gap-4">
              <Heading slot="title" className="text-xl font-semibold">{t('离线加解密工作台', 'Offline cryptography workbench')}</Heading>
              <Button onPress={() => changeOpen(false)} isDisabled={busy} aria-label={t('关闭加解密工作台', 'Close cryptography workbench')}>{t('关闭', 'Close')}</Button>
            </div>
            <p className="text-sm">{t('在本机计算，不上传密钥或正文；关闭窗口时清空本次输入和结果。SM2/SM3/SM4 使用随包固定实现，不依赖系统安装国密库。', 'Computed locally. Closing clears keys, input and results. Bundled SM2/SM3/SM4 do not require a system crypto provider.')}</p>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span>{t('操作类别', 'Operation category')}</span>
                <select aria-label={t('操作类别', 'Operation category')} className={controlClass} value={action} onChange={event => changeAction(event.target.value)}>
                  {actions.map(([value, zh, en]) => <option key={value} value={value}>{t(zh, en)}</option>)}
                </select>
              </label>
              {select('界面语言 / Interface language', locale, ['zh-CN', 'en-US'], value => setOfflineLocale(value === 'en-US' ? 'en-US' : 'zh-CN'))}
              {algorithms[action] && select(t('算法', 'Algorithm'), algorithm, algorithms[action], setAlgorithm)}
              {['cipher', 'rsa', 'jwt', 'sm2'].includes(action) && select(t('处理方式', 'Operation'), operation, action === 'jwt' ? ['verify', 'sign', 'inspect'] : action === 'sm2' ? ['encrypt', 'decrypt', 'sign', 'verify'] : ['encrypt', 'decrypt'], value => {
                setOperation(value);
                setInputEncoding(value === 'decrypt' ? 'base64' : 'utf8'); setOutputEncoding(value === 'decrypt' ? 'utf8' : 'base64');
              })}
              {!['jwt', 'keygen', 'random'].includes(action) && select(t('输入编码', 'Input encoding'), inputEncoding, encodings, setInputEncoding)}
              {!['jwt', 'verify'].includes(action) && select(t('输出编码', 'Output encoding'), outputEncoding, encodings, setOutputEncoding)}
              {keyBased && !asymmetric && action !== 'sm2' && select(t('密钥编码', 'Key encoding'), keyEncoding, encodings, setKeyEncoding)}
              {(keyBased && asymmetric || action === 'keygen' && algorithm !== 'sm2') && select(t('密钥格式', 'Key format'), keyFormat, ['pem', 'der', 'jwk'], setKeyFormat)}
              {['sign', 'verify'].includes(action) && select(t('EC 签名格式', 'EC signature format'), signatureFormat, ['der', 'ieee-p1363'], setSignatureFormat)}
              {action === 'sm2' && ['sign', 'verify'].includes(operation) && select(t('SM2 签名格式', 'SM2 signature format'), signatureFormat, ['der', 'raw'], setSignatureFormat)}
              {action === 'sm2' && ['encrypt', 'decrypt'].includes(operation) && select(t('SM2 密文排列（含 04 点前缀）', 'SM2 ciphertext layout (04 point prefix)'), cipherMode, ['c1c3c2', 'c1c2c3'], setCipherMode)}
              {action === 'cipher' && algorithm.endsWith('cbc') && select(t('填充', 'Padding'), padding, ['pkcs7', 'none'], setPadding)}
            </div>
            {!['keygen', 'random'].includes(action) && (
              <label className="flex flex-col gap-1"><span>{action === 'jwt' && operation === 'sign' ? t('JWT 声明（JSON 对象）', 'JWT claims (JSON object)') : t('输入正文', 'Input')}</span>
                <textarea className={`${controlClass} min-h-24 font-mono`} spellCheck={false} aria-label={action === 'jwt' && operation === 'sign' ? t('JWT 声明（JSON 对象）', 'JWT claims (JSON object)') : t('输入正文', 'Input')} value={input} onChange={event => setInput(event.target.value)} />
              </label>
            )}
            {keyBased && (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1"><span>{t('密钥（仅保存在本次窗口内存中）', 'Key (kept only in this form memory)')}</span>
                  <textarea className={`${controlClass} min-h-20 font-mono`} spellCheck={false} autoComplete="off" aria-label={t('密钥（仅保存在本次窗口内存中）', 'Key (kept only in this form memory)')} value={key} onChange={event => setKey(event.target.value)} style={{ WebkitTextSecurity: showKey ? 'none' : 'disc' } as CSSProperties} />
                </label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={showKey} onChange={event => setShowKey(event.target.checked)} />{t('显示密钥', 'Show key')}</label>
                {asymmetric && <label>{t('私钥口令（可选）', 'Private key passphrase (optional)')}<input className={controlClass} type="password" autoComplete="off" aria-label={t('私钥口令（可选）', 'Private key passphrase (optional)')} value={passphrase} onChange={event => setPassphrase(event.target.value)} /></label>}
              </div>
            )}
            {action === 'sm2' && <p role="note">{t('私钥：64 位十六进制；公钥：04 开头的 130 位十六进制（或压缩点）。签名使用 SM3，并绑定用户标识。', 'Private key: 64 hex digits. Public key: 130 hex digits beginning 04 (or compressed point). SM2 signatures use SM3 and bind the user ID.')}</p>}
            {action === 'sm2' && ['sign', 'verify'].includes(operation) && <label>{t('SM2 用户标识（UTF-8）', 'SM2 user ID (UTF-8)')}<input className={controlClass} aria-label={t('SM2 用户标识（UTF-8）', 'SM2 user ID (UTF-8)')} value={userId} onChange={event => setUserId(event.target.value)} /></label>}
            {action === 'cipher' && <label>{t('IV / Nonce（Hex；加密时留空自动生成）', 'IV / nonce (hex; leave empty to generate on encryption)')}<input className={controlClass} aria-label={t('IV / Nonce（Hex；加密时留空自动生成）', 'IV / nonce (hex; leave empty to generate on encryption)')} value={iv} onChange={event => setIv(event.target.value)} /></label>}
            {action === 'cipher' && algorithm.endsWith('gcm') && (
              <div className="grid grid-cols-2 gap-4">
                <label>AAD (UTF-8)<input className={controlClass} value={aad} onChange={event => setAad(event.target.value)} /></label>
                <label>{t('认证标签（解密必填，Hex）', 'Authentication tag (hex; required to decrypt)')}<input className={controlClass} aria-label={t('认证标签（解密必填，Hex）', 'Authentication tag (hex; required to decrypt)')} value={tag} onChange={event => setTag(event.target.value)} /></label>
              </div>
            )}
            {action === 'rsa' && <label>OAEP label (UTF-8)<input className={controlClass} value={aad} onChange={event => setAad(event.target.value)} /></label>}
            {(action === 'verify' || action === 'sm2' && operation === 'verify') && <label>{t('签名（Base64）', 'Signature (Base64)')}<textarea className={controlClass} aria-label={t('签名（Base64）', 'Signature (Base64)')} value={signature} onChange={event => setSignature(event.target.value)} /></label>}
            {action === 'jwt' && operation === 'verify' && <div className="grid grid-cols-2 gap-4">
              <label>{t('期望签发者 iss（可选）', 'Expected issuer (optional)')}<input className={controlClass} aria-label={t('期望签发者 iss（可选）', 'Expected issuer (optional)')} value={issuer} onChange={event => setIssuer(event.target.value)} /></label>
              <label>{t('期望受众 aud（可选）', 'Expected audience (optional)')}<input className={controlClass} aria-label={t('期望受众 aud（可选）', 'Expected audience (optional)')} value={audience} onChange={event => setAudience(event.target.value)} /></label>
            </div>}
            {action === 'digest' && ['md5', 'sha1'].includes(algorithm) && <label className="flex items-center gap-2"><input type="checkbox" checked={legacy} onChange={event => setLegacy(event.target.checked)} />{t('我仅用于旧接口兼容，不用于安全认证', 'Legacy interface compatibility only, not security authentication')}</label>}
            {action === 'cipher' && !algorithm.endsWith('gcm') && <p role="note">{t('注意：CBC/CTR 不提供完整性认证；不能检测所有篡改。', 'CBC/CTR are not authenticated and cannot detect all tampering.')}</p>}
            <div className="flex gap-3">
              <Button data-testid="offline-crypto-run" onPress={() => { void run(); }} isDisabled={busy} className="rounded-sm border border-solid border-(--hl-md) px-4 py-2">{busy ? t('处理中…', 'Working…') : t('执行', 'Run')}</Button>
              <Button onPress={clear} isDisabled={busy} className="rounded-sm border border-solid border-(--hl-md) px-4 py-2">{t('清空敏感数据', 'Clear sensitive data')}</Button>
            </div>
            {error && <p role="alert" className="whitespace-pre-wrap text-(--color-danger)">{error}</p>}
            <label className="flex flex-col gap-1"><span>{t('结果（可能包含明文或私钥，请妥善处理）', 'Result (may contain plaintext or private keys)')}</span>
              <textarea data-testid="offline-crypto-result" className={`${controlClass} min-h-36 font-mono`} readOnly spellCheck={false} aria-label={t('结果（可能包含明文或私钥，请妥善处理）', 'Result (may contain plaintext or private keys)')} value={result} />
            </label>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
};
