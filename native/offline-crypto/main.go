// Copyright 2026 Live-yum contributors. SPDX-License-Identifier: Apache-2.0
// A single-request, stdin/stdout cryptographic worker. No network, shell, file
// lookup, key persistence or configurable executable is part of this protocol.
package main

import (
	"bytes"
	"crypto/cipher"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha3"
	"crypto/subtle"
	"encoding/asn1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"hash"
	"io"
	"math/big"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/emmansun/gmsm/pkcs8"
	"github.com/emmansun/gmsm/sm2"
	"github.com/emmansun/gmsm/sm3"
	"github.com/emmansun/gmsm/sm4"
	"github.com/emmansun/gmsm/smx509"
)

const maxInput = 4 * 1024 * 1024
const maxRequest = 12 * 1024 * 1024

type Options struct {
	Action            string          `json:"action"`
	Algorithm         string          `json:"algorithm"`
	Operation         string          `json:"operation"`
	Input             string          `json:"input"`
	InputEncoding     string          `json:"inputEncoding"`
	OutputEncoding    string          `json:"outputEncoding"`
	Key               json.RawMessage `json:"key"`
	KeyEncoding       string          `json:"keyEncoding"`
	Format            string          `json:"format"`
	CipherFormat      string          `json:"cipherFormat"`
	Signature         string          `json:"signature"`
	SignatureEncoding string          `json:"signatureEncoding"`
	SignatureFormat   string          `json:"signatureFormat"`
	UserID            *string         `json:"userId"`
	IV                string          `json:"iv"`
	IVEncoding        string          `json:"ivEncoding"`
	Tag               string          `json:"tag"`
	TagEncoding       string          `json:"tagEncoding"`
	AAD               string          `json:"aad"`
	AADEncoding       string          `json:"aadEncoding"`
	Padding           string          `json:"padding"`
}

type Result map[string]any

func invalid(message string) error { return errors.New(message) }
func fallback(value, other string) string {
	if value == "" {
		return other
	}
	return value
}

func decode(value, encoding string) ([]byte, error) {
	if len(value) > 2*maxInput {
		return nil, invalid("输入超过上限 / Input exceeds limit")
	}
	var data []byte
	var err error
	switch fallback(encoding, "utf8") {
	case "utf8":
		if !utf8.ValidString(value) {
			return nil, invalid("无效 UTF-8 / Invalid UTF-8")
		}
		data = []byte(value)
	case "hex":
		data, err = hex.DecodeString(value)
	case "base64":
		data, err = base64.StdEncoding.Strict().DecodeString(value)
		if err == nil && base64.StdEncoding.EncodeToString(data) != value {
			err = invalid("noncanonical")
		}
	case "base64url":
		data, err = base64.RawURLEncoding.Strict().DecodeString(value)
		if err == nil && base64.RawURLEncoding.EncodeToString(data) != value {
			err = invalid("noncanonical")
		}
	default:
		return nil, invalid("不支持的编码 / Unsupported encoding")
	}
	if err != nil || len(data) > maxInput {
		return nil, invalid("无效或过长的编码数据 / Invalid or oversized encoded data")
	}
	return data, nil
}

func encode(data []byte, encoding string) (string, error) {
	switch fallback(encoding, "base64") {
	case "utf8":
		if !utf8.Valid(data) {
			return "", invalid("结果不是 UTF-8，请选择 Hex 或 Base64 / Output is not UTF-8")
		}
		return string(data), nil
	case "hex":
		return hex.EncodeToString(data), nil
	case "base64":
		return base64.StdEncoding.EncodeToString(data), nil
	case "base64url":
		return base64.RawURLEncoding.EncodeToString(data), nil
	default:
		return "", invalid("不支持的输出编码 / Unsupported output encoding")
	}
}

func keyBytes(o Options) ([]byte, error) {
	var value string
	if json.Unmarshal(o.Key, &value) != nil {
		return nil, invalid("对称密钥必须是字符串 / Expected encoded symmetric key")
	}
	return decode(value, fallback(o.KeyEncoding, "hex"))
}

type keyMaterial struct {
	Format     string `json:"format"`
	Data       string `json:"data"`
	Passphrase string `json:"passphrase"`
}

func material(raw json.RawMessage) ([]byte, string, []byte, error) {
	if len(raw) > 65536 {
		return nil, "", nil, invalid("密钥过长 / Key is too large")
	}
	var text string
	var m keyMaterial
	if json.Unmarshal(raw, &text) == nil {
		m.Data = text
		if strings.Contains(text, "-----BEGIN ") {
			m.Format = "pem"
		} else {
			m.Format = "hex"
		}
	} else {
		d := json.NewDecoder(bytes.NewReader(raw))
		d.DisallowUnknownFields()
		if d.Decode(&m) != nil {
			return nil, "", nil, invalid("无效密钥格式 / Invalid key format")
		}
	}
	switch m.Format {
	case "pem":
		block, rest := pem.Decode([]byte(m.Data))
		if block == nil || len(bytes.TrimSpace(rest)) != 0 || len(block.Headers) != 0 {
			return nil, "", nil, invalid("需要单个 PEM 密钥 / Expected a single PEM key")
		}
		return block.Bytes, block.Type, []byte(m.Passphrase), nil
	case "der":
		data, err := decode(m.Data, "base64")
		return data, "DER", []byte(m.Passphrase), err
	case "hex":
		data, err := decode(m.Data, "hex")
		return data, "HEX", nil, err
	default:
		return nil, "", nil, invalid("SM2 支持 PEM、DER 或 Hex 密钥 / SM2 supports PEM, DER or Hex keys")
	}
}

func privateKey(raw json.RawMessage) (*sm2.PrivateKey, error) {
	data, kind, password, err := material(raw)
	if err != nil {
		return nil, err
	}
	defer clear(data)
	defer clear(password)
	var key *sm2.PrivateKey
	if kind == "HEX" {
		key, err = sm2.NewPrivateKey(data)
	} else if kind == "EC PRIVATE KEY" {
		var ec *ecdsa.PrivateKey
		ec, err = smx509.ParseECPrivateKey(data)
		if err == nil {
			key, err = new(sm2.PrivateKey).FromECPrivateKey(ec)
		}
	} else if kind == "PRIVATE KEY" || kind == "ENCRYPTED PRIVATE KEY" || kind == "DER" {
		key, err = pkcs8.ParsePKCS8PrivateKeySM2(data, password)
	} else {
		err = invalid("wrong kind")
	}
	if err != nil || key == nil {
		return nil, invalid("无效 SM2 私钥或口令 / Invalid SM2 private key or passphrase")
	}
	return key, nil
}

func publicKey(raw json.RawMessage) (*ecdsa.PublicKey, error) {
	data, kind, _, err := material(raw)
	if err != nil {
		return nil, err
	}
	if kind == "HEX" {
		key, err := sm2.NewPublicKey(data)
		if err != nil {
			return nil, invalid("无效 SM2 公钥点 / Invalid SM2 public point")
		}
		return key, nil
	}
	if kind != "PUBLIC KEY" && kind != "DER" {
		return nil, invalid("请提供 SM2 公钥而非私钥 / Expected SM2 public key")
	}
	value, err := smx509.ParsePKIXPublicKey(data)
	if err != nil {
		return nil, invalid("无效 SM2 公钥 / Invalid SM2 public key")
	}
	key, ok := value.(*ecdsa.PublicKey)
	if !ok || key.Curve.Params().N.Cmp(sm2.P256().Params().N) != 0 || !sm2.P256().IsOnCurve(key.X, key.Y) {
		return nil, invalid("密钥必须使用 SM2 曲线 / Key must use the SM2 curve")
	}
	return key, nil
}

func sm2Keys(o Options) (Result, error) {
	key, err := sm2.GenerateKey(rand.Reader)
	if err != nil {
		return nil, invalid("无法生成 SM2 密钥 / Key generation failed")
	}
	format := fallback(o.Format, "pem")
	result := Result{"algorithm": "SM2", "format": format}
	if format == "hex" {
		result["privateKey"] = hex.EncodeToString(key.D.FillBytes(make([]byte, 32)))
		result["publicKey"] = hex.EncodeToString(elliptic.Marshal(sm2.P256(), key.X, key.Y))
		return result, nil
	}
	if format != "pem" && format != "der" {
		return nil, invalid("SM2 密钥格式必须是 PEM、DER 或 Hex / Invalid SM2 key output format")
	}
	priv, err := smx509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, invalid("私钥编码失败 / Key encoding failed")
	}
	pub, err := smx509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return nil, invalid("公钥编码失败 / Key encoding failed")
	}
	if format == "pem" {
		result["privateKey"] = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: priv}))
		result["publicKey"] = string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}))
	} else {
		result["privateKey"] = base64.StdEncoding.EncodeToString(priv)
		result["publicKey"] = base64.StdEncoding.EncodeToString(pub)
	}
	return result, nil
}

func sm2Cipher(o Options) (Result, error) {
	operation := o.Operation
	if operation != "encrypt" && operation != "decrypt" {
		return nil, invalid("请选择加密或解密 / Choose encrypt or decrypt")
	}
	inEncoding := fallback(o.InputEncoding, "utf8")
	outEncoding := fallback(o.OutputEncoding, "base64")
	if operation == "decrypt" {
		inEncoding = fallback(o.InputEncoding, "base64")
		outEncoding = fallback(o.OutputEncoding, "utf8")
	}
	input, err := decode(o.Input, inEncoding)
	if err != nil {
		return nil, err
	}
	defer clear(input)
	if len(input) == 0 {
		return nil, invalid("SM2 输入不可为空 / SM2 input must not be empty")
	}
	format := fallback(o.CipherFormat, "asn1")
	encOpts := sm2.ASN1EncrypterOpts
	decOpts := sm2.ASN1DecrypterOpts
	switch format {
	case "asn1":
	case "c1c3c2":
		encOpts = sm2.NewPlainEncrypterOpts(sm2.MarshalUncompressed, sm2.C1C3C2)
		decOpts = sm2.NewPlainDecrypterOpts(sm2.C1C3C2)
	case "c1c2c3":
		encOpts = sm2.NewPlainEncrypterOpts(sm2.MarshalUncompressed, sm2.C1C2C3)
		decOpts = sm2.NewPlainDecrypterOpts(sm2.C1C2C3)
	default:
		return nil, invalid("不支持的 SM2 密文格式 / Unsupported SM2 ciphertext format")
	}
	var output []byte
	if operation == "encrypt" {
		key, err := publicKey(o.Key)
		if err != nil {
			return nil, err
		}
		output, err = sm2.Encrypt(rand.Reader, key, input, encOpts)
		if err != nil {
			return nil, invalid("SM2 加密失败 / SM2 encryption failed")
		}
	} else {
		key, err := privateKey(o.Key)
		if err != nil {
			return nil, err
		}
		output, err = key.Decrypt(nil, input, decOpts)
		if err != nil {
			return nil, invalid("SM2 解密或完整性检查失败 / SM2 decryption or integrity check failed")
		}
	}
	defer clear(output)
	value, err := encode(output, outEncoding)
	if err != nil {
		return nil, err
	}
	return Result{"output": value, "algorithm": "SM2", "cipherFormat": format, "encoding": outEncoding}, nil
}

type signaturePair struct{ R, S *big.Int }

func canonicalSignature(sig []byte, format string) ([]byte, error) {
	if format == "ieee-p1363" {
		if len(sig) != 64 {
			return nil, invalid("invalid signature")
		}
		return asn1.Marshal(signaturePair{new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])})
	}
	if format != "der" {
		return nil, invalid("invalid signature format")
	}
	var pair signaturePair
	rest, err := asn1.Unmarshal(sig, &pair)
	if err != nil || len(rest) != 0 || pair.R == nil || pair.S == nil {
		return nil, invalid("invalid signature")
	}
	canonical, err := asn1.Marshal(pair)
	if err != nil || !bytes.Equal(canonical, sig) {
		return nil, invalid("noncanonical signature")
	}
	return canonical, nil
}

func sm2Signature(o Options) (Result, error) {
	input, err := decode(o.Input, fallback(o.InputEncoding, "utf8"))
	if err != nil {
		return nil, err
	}
	uid := []byte("1234567812345678")
	if o.UserID != nil {
		uid = []byte(*o.UserID)
		if len(uid) == 0 {
			return nil, invalid("SM2 用户标识不可为空 / SM2 user ID must not be empty")
		}
	}
	if len(uid) > 8191 {
		return nil, invalid("SM2 用户标识过长 / SM2 user ID is too long")
	}
	format := fallback(o.SignatureFormat, "der")
	if format != "der" && format != "ieee-p1363" {
		return nil, invalid("不支持的签名格式 / Unsupported signature format")
	}
	if o.Action == "verify" {
		key, err := publicKey(o.Key)
		if err != nil {
			return nil, err
		}
		sig, err := decode(o.Signature, fallback(o.SignatureEncoding, "base64"))
		if err != nil {
			return nil, err
		}
		canonical, err := canonicalSignature(sig, format)
		valid := err == nil && sm2.VerifyASN1WithSM2(key, uid, input, canonical)
		return Result{"valid": valid, "algorithm": "SM2-SM3", "userId": string(uid)}, nil
	}
	key, err := privateKey(o.Key)
	if err != nil {
		return nil, err
	}
	sig, err := key.Sign(rand.Reader, input, sm2.NewSM2SignerOption(true, uid))
	if err != nil {
		return nil, invalid("SM2 签名失败 / SM2 signing failed")
	}
	if format == "ieee-p1363" {
		var pair signaturePair
		rest, err := asn1.Unmarshal(sig, &pair)
		if err != nil || len(rest) > 0 || pair.R == nil || pair.S == nil {
			return nil, invalid("SM2 签名编码失败 / SM2 signature encoding failed")
		}
		sig = append(pair.R.FillBytes(make([]byte, 32)), pair.S.FillBytes(make([]byte, 32))...)
	}
	value, err := encode(sig, fallback(o.OutputEncoding, "base64"))
	if err != nil {
		return nil, err
	}
	return Result{"output": value, "algorithm": "SM2-SM3", "signatureFormat": format, "userId": string(uid)}, nil
}

func hashFactory(algorithm string) (func() hash.Hash, error) {
	switch algorithm {
	case "sm3":
		return sm3.New, nil
	case "sha3-224":
		return func() hash.Hash { return sha3.New224() }, nil
	case "sha3-256":
		return func() hash.Hash { return sha3.New256() }, nil
	case "sha3-384":
		return func() hash.Hash { return sha3.New384() }, nil
	case "sha3-512":
		return func() hash.Hash { return sha3.New512() }, nil
	default:
		return nil, invalid("不支持的摘要 / Unsupported digest")
	}
}

func digest(o Options) (Result, error) {
	factory, err := hashFactory(o.Algorithm)
	if err != nil {
		return nil, err
	}
	input, err := decode(o.Input, fallback(o.InputEncoding, "utf8"))
	if err != nil {
		return nil, err
	}
	h := factory()
	if o.Action == "hmac" {
		key, err := keyBytes(o)
		if err != nil {
			return nil, err
		}
		defer clear(key)
		if len(key) == 0 {
			return nil, invalid("HMAC 密钥不可为空 / HMAC key must not be empty")
		}
		h = hmac.New(factory, key)
	}
	_, _ = h.Write(input)
	output, err := encode(h.Sum(nil), fallback(o.OutputEncoding, "hex"))
	if err != nil {
		return nil, err
	}
	return Result{"output": output, "algorithm": o.Algorithm}, nil
}

func unpad(data []byte) ([]byte, error) {
	if len(data) == 0 || len(data)%16 != 0 {
		return nil, invalid("解密或填充检查失败 / Decryption or padding check failed")
	}
	n := int(data[len(data)-1])
	good := subtle.ConstantTimeLessOrEq(1, n) & subtle.ConstantTimeLessOrEq(n, 16)
	for i := 1; i <= 16; i++ {
		good &= 1 ^ (subtle.ConstantTimeLessOrEq(i, n) & (1 ^ subtle.ConstantTimeByteEq(data[len(data)-i], byte(n))))
	}
	if good != 1 {
		clear(data)
		return nil, invalid("解密或填充检查失败 / Decryption or padding check failed")
	}
	return data[:len(data)-n], nil
}

func sm4Cipher(o Options) (Result, error) {
	if o.Operation != "encrypt" && o.Operation != "decrypt" {
		return nil, invalid("请选择加密或解密 / Choose encrypt or decrypt")
	}
	key, err := keyBytes(o)
	if err != nil {
		return nil, err
	}
	defer clear(key)
	if len(key) != 16 {
		return nil, invalid("SM4 密钥必须是 16 字节 / SM4 requires a 16-byte key")
	}
	block, err := sm4.NewCipher(key)
	if err != nil {
		return nil, invalid("SM4 密钥错误 / Invalid SM4 key")
	}
	data, err := decode(o.Input, fallback(o.InputEncoding, "utf8"))
	if err != nil {
		return nil, err
	}
	defer clear(data)
	mode := strings.TrimPrefix(o.Algorithm, "sm4-")
	if mode != "cbc" && mode != "ctr" && mode != "gcm" {
		return nil, invalid("不支持的 SM4 模式 / Unsupported SM4 mode")
	}
	ivLen := 16
	if mode == "gcm" {
		ivLen = 12
	}
	iv, err := decode(o.IV, fallback(o.IVEncoding, "hex"))
	if err != nil {
		return nil, err
	}
	if len(iv) == 0 && o.Operation == "encrypt" {
		iv = make([]byte, ivLen)
		if _, err = rand.Read(iv); err != nil {
			return nil, invalid("安全随机数不可用 / Secure randomness unavailable")
		}
	}
	if len(iv) != ivLen {
		return nil, invalid("IV 长度不正确，解密时必须提供原始 IV / Invalid or missing IV")
	}
	var output []byte
	result := Result{"algorithm": o.Algorithm, "iv": hex.EncodeToString(iv), "ivEncoding": "hex"}
	if mode == "gcm" {
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, invalid("GCM 初始化失败 / GCM initialization failed")
		}
		aad, err := decode(o.AAD, fallback(o.AADEncoding, "utf8"))
		if err != nil {
			return nil, err
		}
		if o.Operation == "encrypt" {
			sealed := aead.Seal(nil, iv, data, aad)
			output = sealed[:len(sealed)-16]
			result["tag"] = hex.EncodeToString(sealed[len(sealed)-16:])
			result["tagEncoding"] = "hex"
		} else {
			tag, err := decode(o.Tag, fallback(o.TagEncoding, "hex"))
			if err != nil {
				return nil, err
			}
			if len(tag) != 16 {
				return nil, invalid("认证标签必须为 16 字节 / Invalid authentication tag length")
			}
			output, err = aead.Open(nil, iv, append(data, tag...), aad)
			if err != nil {
				return nil, invalid("认证失败，未返回明文 / Authentication failed; no plaintext returned")
			}
		}
	} else if mode == "ctr" {
		output = make([]byte, len(data))
		cipher.NewCTR(block, iv).XORKeyStream(output, data)
		result["warning"] = "CTR 不提供完整性认证 / CTR does not authenticate ciphertext"
	} else {
		padding := fallback(o.Padding, "pkcs7")
		if padding != "pkcs7" && padding != "none" {
			return nil, invalid("不支持的填充 / Unsupported padding")
		}
		if o.Operation == "encrypt" && padding == "pkcs7" {
			n := 16 - len(data)%16
			data = append(data, bytes.Repeat([]byte{byte(n)}, n)...)
		}
		if len(data)%16 != 0 {
			return nil, invalid("CBC 输入长度不符合分组大小 / Invalid CBC block length")
		}
		output = make([]byte, len(data))
		if o.Operation == "encrypt" {
			cipher.NewCBCEncrypter(block, iv).CryptBlocks(output, data)
		} else {
			cipher.NewCBCDecrypter(block, iv).CryptBlocks(output, data)
			if padding == "pkcs7" {
				output, err = unpad(output)
				if err != nil {
					return nil, err
				}
			}
		}
		result["warning"] = "CBC 不提供完整性认证 / CBC does not authenticate ciphertext"
	}
	defer clear(output)
	value, err := encode(output, fallback(o.OutputEncoding, "base64"))
	if err != nil {
		return nil, err
	}
	result["output"] = value
	return result, nil
}

func execute(raw []byte) (result Result, err error) {
	defer func() {
		if recover() != nil {
			result = nil
			err = invalid("无效加解密参数 / Invalid cryptographic parameters")
		}
	}()
	if len(raw) > maxRequest || !utf8.Valid(raw) {
		return nil, invalid("输入过长或编码错误 / Invalid request")
	}
	var o Options
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&o) != nil {
		return nil, invalid("无效请求字段 / Invalid request fields")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return nil, invalid("只能提交一个请求 / Expected one request")
	}
	switch o.Action {
	case "keygen":
		if o.Algorithm == "SM2" || o.Algorithm == "sm2" {
			return sm2Keys(o)
		}
	case "sm2":
		return sm2Cipher(o)
	case "sign", "verify":
		if o.Algorithm == "SM2" || o.Algorithm == "SM2-SM3" {
			return sm2Signature(o)
		}
	case "digest", "hmac":
		return digest(o)
	case "cipher":
		return sm4Cipher(o)
	}
	return nil, invalid("此模块不支持该操作 / Unsupported native crypto operation")
}

func main() {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, maxRequest+1))
	if err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": "无法读取输入 / Cannot read input"})
		os.Exit(1)
	}
	result, err := execute(raw)
	clear(raw)
	if err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": err.Error()})
		os.Exit(1)
	}
	if json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "result": result}) != nil {
		os.Exit(1)
	}
}
