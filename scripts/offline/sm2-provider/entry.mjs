// Explicit tree-shaken exports. No ECDH/KX or unrelated SM4/hash implementations.
import { sm2 } from 'sm-crypto-v2';
export const initRNGPool = sm2.initRNGPool;
export const generateKeyPairHex = sm2.generateKeyPairHex;
export const getPublicKeyFromPrivateKey = sm2.getPublicKeyFromPrivateKey;
export const verifyPublicKey = sm2.verifyPublicKey;
export const doEncrypt = sm2.doEncrypt;
export const doDecrypt = sm2.doDecrypt;
export const doSignature = sm2.doSignature;
export const doVerifySignature = sm2.doVerifySignature;
