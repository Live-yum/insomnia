const assert = require('assert');
const { describe, it } = require('mocha');
const { encrypt, decrypt, SUPPORTED_ALGORITHMS } = require('../encrypt');
const { Buffer } = require('buffer');

describe('encrypt.js', () => {
  const algorithm = 'aes-256-cbc';
  const key = '12345678901234567890123456789012';
  const text = 'Hello, World!';

  it('should encrypt and decrypt text correctly', () => {
    const encrypted = encrypt(text, algorithm, key);
    const decrypted = decrypt(encrypted, algorithm, key);
    assert.strictEqual(decrypted, text);
  });

  it('should throw an error for unsupported algorithm', () => {
    assert.throws(() => encrypt(text, 'unsupported-algorithm', key));
  });

  it('should throw an error for invalid key length', () => {
    const invalidKey = 'shortkey';
    assert.throws(() => encrypt(text, algorithm, invalidKey));
  });

  // Test all supported algorithms
  SUPPORTED_ALGORITHMS.forEach(algo => {
    it(`should encrypt and decrypt correctly with ${algo}`, () => {
      const keyLength = parseInt(algo.split('-')[1], 10) / 8;
      const testKey = '1'.repeat(keyLength);

      const encrypted = encrypt(text, algo, testKey);
      const decrypted = decrypt(encrypted, algo, testKey);
      assert.strictEqual(decrypted, text);
    });
  });

  it('should handle empty strings', () => {
    const emptyText = '';
    const encrypted = encrypt(emptyText, algorithm, key);
    const decrypted = decrypt(encrypted, algorithm, key);
    assert.strictEqual(decrypted, emptyText);
  });

  it('should handle long text', () => {
    const longText = 'a'.repeat(10000);
    const encrypted = encrypt(longText, algorithm, key);
    const decrypted = decrypt(encrypted, algorithm, key);
    assert.strictEqual(decrypted, longText);
  });

  it('should handle special characters', () => {
    const specialText = 'Special characters: !@#$%^&*()_+{}|:"<>?[];\',./-=';
    const encrypted = encrypt(specialText, algorithm, key);
    const decrypted = decrypt(encrypted, algorithm, key);
    assert.strictEqual(decrypted, specialText);
  });

  it('should handle non-string input by converting to string', () => {
    const nonStringInput = { hello: 'world' };
    const stringified = JSON.stringify(nonStringInput);

    const encrypted = encrypt(stringified, algorithm, key);
    const decrypted = decrypt(encrypted, algorithm, key);

    assert.strictEqual(decrypted, stringified);
    assert.deepStrictEqual(JSON.parse(decrypted), nonStringInput);
  });

  it('should fail when decrypting with wrong key', () => {
    const encrypted = encrypt(text, algorithm, key);
    const wrongKey = '12345678901234567890123456789013'; // different last character

    assert.throws(() => {
      decrypt(encrypted, algorithm, wrongKey);
    });
  });

  it('should fail when decrypting with wrong algorithm', () => {
    const encrypted = encrypt(text, 'aes-256-cbc', key);

    assert.throws(() => {
      decrypt(encrypted, 'aes-256-cfb', key);
    });
  });

  it('should not be equal when decrypting corrupted data', () => {
    let encrypted = encrypt(text, algorithm, key);
    const corruptedEncrypted = Buffer.concat([Buffer.from('X'), encrypted.slice(1)]);

    const decrypted = decrypt(corruptedEncrypted, algorithm, key);
    
    assert.notStrictEqual(decrypted, text);
  });

  it('should preserve binary data when encrypting and decrypting', () => {
    // Create some binary data
    const binaryData = Buffer.from([0xFF, 0x00, 0xAB, 0xCD]).toString('binary');

    const encrypted = encrypt(binaryData, algorithm, key);
    const decrypted = decrypt(encrypted, algorithm, key);

    assert.strictEqual(decrypted, binaryData);
  });

  it('should throw an error for null input', () => {
    assert.throws(() => {
      encrypt(null, algorithm, key);
    });
  });

  it('should throw an error for undefined input', () => {
    assert.throws(() => {
      encrypt(undefined, algorithm, key);
    });
  });
});
