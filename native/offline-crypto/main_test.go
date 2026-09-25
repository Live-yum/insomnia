package main

import (
 "bytes"
 "encoding/base64"
 "encoding/hex"
 "encoding/json"
 "os"
 "os/exec"
 "path/filepath"
 "testing"
)

func call(t *testing.T, o map[string]any) Result { t.Helper(); raw,_:=json.Marshal(o);r,e:=execute(raw);if e!=nil{t.Fatal(e)};return r }
func reject(t *testing.T,o map[string]any){t.Helper();raw,_:=json.Marshal(o);r,e:=execute(raw);if e==nil||r!=nil{t.Fatal("invalid input returned a result")}}
func key(v any) json.RawMessage { data,_:=json.Marshal(v);return data }

func TestPublishedSM2Vectors(t *testing.T){
 priv:="6c5a0a0b2eed3cbec3e4f1252bfe0e28c504a1c6bf1999eebb0af9ef0f8e6c85"
 pub:="048356e642a40ebd18d29ba3532fbd9f3bbee8f027c3f6f39a5ba2f870369f9988981f5efe55d1c5cdf6c0ef2b070847a14f7fdf4272a8df09c442f3058af94ba1"
 sig:="304402205b3a799bd94c9063120d7286769220af6b0fa127009af3e873c0e8742edc5f890220097968a4c8b040fd548d1456b33f470cabd8456bfea53e8a828f92f6d4bdcd77"
 if !call(t,map[string]any{"action":"verify","algorithm":"SM2","key":pub,"input":"ShangMi SM2 Sign Standard","signature":sig,"signatureEncoding":"hex"})["valid"].(bool){t.Fatal("published signature rejected")}
 cipher:="308194022100bd31001ce8d39a4a0119ff96d71334cd12d8b75bbc780f5bfc6e1efab535e85a02201839c075ff8bf761dcbe185c9750816410517001d6a130f6ab97fb23337cce150420ea82bd58d6a5394eb468a769ab48b6a26870ca075377eb06663780c920ea5ee0042be22abcf48e56ae9d29ac770d9de0d6b7094a874a2f8d26c26e0b1daaf4ff50a484b88163d04785b04585bb"
 got:=call(t,map[string]any{"action":"sm2","operation":"decrypt","key":priv,"input":cipher,"inputEncoding":"hex","outputEncoding":"utf8"})
 if got["output"]!="send reinforcements, we're going to advance"{t.Fatal("published ciphertext differs")}
}

func TestSM2KeyFormatsAndIntegrity(t *testing.T){
 for _,format:=range []string{"pem","der","hex"}{t.Run(format,func(t *testing.T){
  keys:=call(t,map[string]any{"action":"keygen","algorithm":"SM2","format":format})
  priv:=map[string]any{"format":format,"data":keys["privateKey"]};pub:=map[string]any{"format":format,"data":keys["publicKey"]}
  for _,mode:=range []string{"asn1","c1c3c2","c1c2c3"}{
   o:=map[string]any{"action":"sm2","operation":"encrypt","key":pub,"input":"000180ff","inputEncoding":"hex","outputEncoding":"base64","cipherFormat":mode}
   encrypted:=call(t,o)["output"].(string);if encrypted==call(t,o)["output"]{t.Fatal("repeated ephemeral key")}
   d:=map[string]any{"action":"sm2","operation":"decrypt","key":priv,"input":encrypted,"inputEncoding":"base64","outputEncoding":"hex","cipherFormat":mode}
   if call(t,d)["output"]!="000180ff"{t.Fatal("binary mismatch")}
   data,_:=base64.StdEncoding.DecodeString(encrypted);data[len(data)-1]^=1;d["input"]=base64.StdEncoding.EncodeToString(data);reject(t,d)
  }
  for _,signatureFormat:=range []string{"der","ieee-p1363"}{
   s:=call(t,map[string]any{"action":"sign","algorithm":"SM2","key":priv,"input":"中文 🔒","userId":"offline-user","signatureFormat":signatureFormat})
   v:=map[string]any{"action":"verify","algorithm":"SM2","key":pub,"input":"中文 🔒","userId":"offline-user","signatureFormat":signatureFormat,"signature":s["output"]}
   if !call(t,v)["valid"].(bool){t.Fatal("signature roundtrip failed")};v["userId"]="wrong-user";if call(t,v)["valid"].(bool){t.Fatal("wrong UID accepted")}
   v["userId"]="offline-user";v["input"]="changed";if call(t,v)["valid"].(bool){t.Fatal("changed text accepted")}
  }
 })}
}

func TestSM3AndSM4KnownAnswers(t *testing.T){
 if call(t,map[string]any{"action":"digest","algorithm":"sm3","input":"abc"})["output"]!="66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0"{t.Fatal("SM3 vector")}
 k:="0123456789abcdeffedcba9876543210"
 if call(t,map[string]any{"action":"cipher","algorithm":"sm4-cbc","operation":"encrypt","key":k,"iv":"00000000000000000000000000000000","input":k,"inputEncoding":"hex","outputEncoding":"hex","padding":"none"})["output"]!="681edf34d206965e86b3e94f536e4246"{t.Fatal("SM4 vector")}
 for _,mode:=range []string{"sm4-cbc","sm4-ctr","sm4-gcm"}{for _,text:=range []string{"","国密中文 🔒"}{
  e:=call(t,map[string]any{"action":"cipher","algorithm":mode,"operation":"encrypt","key":k,"input":text})
  d:=map[string]any{"action":"cipher","algorithm":mode,"operation":"decrypt","key":k,"input":e["output"],"inputEncoding":"base64","outputEncoding":"utf8","iv":e["iv"]};if mode=="sm4-gcm"{d["tag"]=e["tag"]}
  if call(t,d)["output"]!=text{t.Fatal("SM4 roundtrip")};if mode=="sm4-gcm"{d["tag"]="00000000000000000000000000000000";reject(t,d)}
 }}
}

func TestProtocolRejectsMalformedAndUnknownInputs(t *testing.T){
 for _,raw:=range []string{"{}","null","{\"action\":\"digest\",\"algorithm\":\"sm3\",\"path\":\"/secret\"}","{} {}","[1]"}{if r,e:=execute([]byte(raw));e==nil||r!=nil{t.Fatal("invalid protocol accepted")}}
 for _,encoded:=range []string{"YQ==\n","YQ=","YR==","%%%%"}{reject(t,map[string]any{"action":"digest","algorithm":"sm3","input":encoded,"inputEncoding":"base64"})}
 reject(t,map[string]any{"action":"cipher","algorithm":"sm4-ecb","operation":"encrypt","key":"00000000000000000000000000000000"})
 reject(t,map[string]any{"action":"sm2","operation":"encrypt","key":"00","input":""})
 reject(t,map[string]any{"action":"sign","algorithm":"SM2","key":"00","input":"abc"})
}

func TestSHA3PublishedAnswer(t *testing.T){if call(t,map[string]any{"action":"digest","algorithm":"sha3-256","input":"abc"})["output"]!="3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532"{t.Fatal("SHA3 vector")}}

func TestOpenSSLInteroperability(t *testing.T){
 // An independent executable implementation is mandatory in the CI job.
 openssl,e:=exec.LookPath("openssl");if e!=nil{t.Fatal("OpenSSL interop verifier is required")}
 dir:=t.TempDir();keys:=call(t,map[string]any{"action":"keygen","algorithm":"SM2"})
 priv:=filepath.Join(dir,"private.pem");pub:=filepath.Join(dir,"public.pem");message:=filepath.Join(dir,"input.bin");sigfile:=filepath.Join(dir,"signature.der");cipherfile:=filepath.Join(dir,"cipher.der")
 for file,data:=range map[string]string{priv:keys["privateKey"].(string),pub:keys["publicKey"].(string),message:"independent 中文\x00\xff"}{if e:=os.WriteFile(file,[]byte(data),0600);e!=nil{t.Fatal(e)}}
 run:=func(args ...string)[]byte{t.Helper();cmd:=exec.Command(openssl,args...);out,err:=cmd.CombinedOutput();if err!=nil{t.Fatalf("OpenSSL failed: %s",out)};return out}
 run("pkeyutl","-encrypt","-pubin","-inkey",pub,"-in",message,"-out",cipherfile)
 ciphertext,e:=os.ReadFile(cipherfile);if e!=nil{t.Fatal(e)}
 d:=call(t,map[string]any{"action":"sm2","operation":"decrypt","key":keys["privateKey"],"input":hex.EncodeToString(ciphertext),"inputEncoding":"hex","outputEncoding":"hex"})
 original,e:=os.ReadFile(message);if e!=nil{t.Fatal(e)};if d["output"]!=hex.EncodeToString(original){t.Fatal("OpenSSL encryption -> helper decryption mismatch")}
 enc:=call(t,map[string]any{"action":"sm2","operation":"encrypt","key":keys["publicKey"],"input":hex.EncodeToString(original),"inputEncoding":"hex","outputEncoding":"hex"})
 ciphertext,e=hex.DecodeString(enc["output"].(string));if e!=nil{t.Fatal(e)};if e=os.WriteFile(cipherfile,ciphertext,0600);e!=nil{t.Fatal(e)}
 if !bytes.Equal(run("pkeyutl","-decrypt","-inkey",priv,"-in",cipherfile),original){t.Fatal("helper encryption -> OpenSSL decryption mismatch")}
 run("pkeyutl","-sign","-rawin","-digest","sm3","-pkeyopt","distid:offline-interop","-inkey",priv,"-in",message,"-out",sigfile)
 sig,e:=os.ReadFile(sigfile);if e!=nil{t.Fatal(e)}
 if !call(t,map[string]any{"action":"verify","algorithm":"SM2","key":keys["publicKey"],"input":hex.EncodeToString(original),"inputEncoding":"hex","signature":hex.EncodeToString(sig),"signatureEncoding":"hex","userId":"offline-interop"})["valid"].(bool){t.Fatal("OpenSSL signature rejected")}
 signed:=call(t,map[string]any{"action":"sign","algorithm":"SM2","key":keys["privateKey"],"input":hex.EncodeToString(original),"inputEncoding":"hex","outputEncoding":"hex","userId":"offline-interop"})
 sig,e=hex.DecodeString(signed["output"].(string));if e!=nil{t.Fatal(e)};if e=os.WriteFile(sigfile,sig,0600);e!=nil{t.Fatal(e)}
 run("pkeyutl","-verify","-rawin","-digest","sm3","-pkeyopt","distid:offline-interop","-pubin","-inkey",pub,"-in",message,"-sigfile",sigfile)
}
