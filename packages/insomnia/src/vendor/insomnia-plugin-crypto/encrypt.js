const crypto = require('crypto');
const { Buffer } = require('buffer');

const SUPPORTED_ALGORITHMS = ['aes-256-cbc', 'aes-192-cbc', 'aes-128-cbc'];

const validateAlgorithmAndKey = (algorithm, key) => {
  if (!SUPPORTED_ALGORITHMS.includes(algorithm)) {
    throw new Error(`Unsupported algorithm: ${algorithm}. Supported algorithms are: ${SUPPORTED_ALGORITHMS.join(', ')}`);
  }

  const keyBytes = Buffer.from(key, 'utf8');
  const requiredKeyLength = parseInt(algorithm.split('-')[1], 10) / 8;

  if (keyBytes.length !== requiredKeyLength) {
    throw new Error(`Invalid key length for ${algorithm}. Expected ${requiredKeyLength} bytes, got ${keyBytes.length} bytes.`);
  }
};

const encrypt = (request, algorithm, key) => {
  validateAlgorithmAndKey(algorithm, key);

  const keyBuffer = Buffer.from(key, 'utf8');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, keyBuffer, iv);

  let encrypted = cipher.update(request, 'utf-8', 'binary');
  encrypted += cipher.final('binary');

  return Buffer.concat([iv, Buffer.from(encrypted, 'binary')]);
};

const decrypt = (response, algorithm, key) => {
  validateAlgorithmAndKey(algorithm, key);

  // TODO: make iv as optional param
  const iv = response.slice(0, 16);
  const encryptedData = response.slice(16);

  const keyBuffer = Buffer.from(key, 'utf8');
  const decipher = crypto.createDecipheriv(algorithm, keyBuffer, iv);

  let decrypted = decipher.update(encryptedData, 'binary', 'utf8');
  decrypted += decipher.final('utf-8');

  return decrypted;
};

module.exports = {
  SUPPORTED_ALGORITHMS,
  encrypt,
  decrypt,
};
