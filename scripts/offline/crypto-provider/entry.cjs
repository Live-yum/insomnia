'use strict';
// Build input, never a runtime require of an uninstalled package.
const { sm2, sm3, sm4 } = require('sm-crypto-v2');
const { sha3_224, sha3_256, sha3_384, sha3_512 } = require('@noble/hashes/sha3');
const { hmac } = require('@noble/hashes/hmac');
module.exports = { sm2: { ...sm2 }, sm3, sm4, hmac,
  sha3: { 'sha3-224': sha3_224, 'sha3-256': sha3_256, 'sha3-384': sha3_384, 'sha3-512': sha3_512 } };
