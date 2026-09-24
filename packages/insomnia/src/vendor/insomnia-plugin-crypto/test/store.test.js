const assert = require('assert');
const { describe, it, beforeEach } = require('mocha');
const {
  setFeature,
  isFeatureEnabled,
  enableRequestEncryption,
  enableResponseDecryption
} = require('../store');

describe('store.js', () => {
  // Mock store implementation
  let mockStore;

  beforeEach(() => {
    // Reset mock store before each test
    mockStore = {
      storage: new Map(),
      getItem: async function (key) {
        return this.storage.get(key);
      },
      setItem: async function (key, value) {
        this.storage.set(key, value.toString());
        return true;
      }
    };
  });

  describe('setFeature', () => {
    it('should store feature value for an item', async () => {
      const itemId = 'test-item-123';
      const feature = 'testFeature';
      await setFeature(mockStore, itemId, feature, true);
      const storedValue = await mockStore.getItem('testFeature:test-item-123');
      assert.strictEqual(storedValue, 'true');
    });

    it('should update feature value when called multiple times', async () => {
      const itemId = 'test-item-123';
      const feature = 'testFeature';
      await setFeature(mockStore, itemId, feature, true);
      await setFeature(mockStore, itemId, feature, false);
      const storedValue = await mockStore.getItem('testFeature:test-item-123');
      assert.strictEqual(storedValue, 'false');
    });

    it('should store different values for different features', async () => {
      const itemId = 'test-item-123';
      await setFeature(mockStore, itemId, 'feature1', true);
      await setFeature(mockStore, itemId, 'feature2', false);

      const storedValue1 = await mockStore.getItem('feature1:test-item-123');
      const storedValue2 = await mockStore.getItem('feature2:test-item-123');

      assert.strictEqual(storedValue1, 'true');
      assert.strictEqual(storedValue2, 'false');
    });

    it('should store different values for different items', async () => {
      const feature = 'testFeature';
      await setFeature(mockStore, 'item1', feature, true);
      await setFeature(mockStore, 'item2', feature, false);

      const storedValue1 = await mockStore.getItem('testFeature:item1');
      const storedValue2 = await mockStore.getItem('testFeature:item2');

      assert.strictEqual(storedValue1, 'true');
      assert.strictEqual(storedValue2, 'false');
    });
  });

  describe('isFeatureEnabled', () => {
    it('should return true when feature is enabled', async () => {
      const itemId = 'test-item-123';
      const feature = 'testFeature';
      await mockStore.setItem('testFeature:test-item-123', 'true');
      const result = await isFeatureEnabled(mockStore, itemId, feature);
      assert.strictEqual(result, true);
    });

    it('should return false when feature is disabled', async () => {
      const itemId = 'test-item-123';
      const feature = 'testFeature';
      await mockStore.setItem('testFeature:test-item-123', 'false');
      const result = await isFeatureEnabled(mockStore, itemId, feature);
      assert.strictEqual(result, false);
    });

    it('should return false when no value is set', async () => {
      const itemId = 'test-item-123';
      const feature = 'testFeature';
      const result = await isFeatureEnabled(mockStore, itemId, feature);
      assert.strictEqual(result, false);
    });

    it('should return false for invalid values', async () => {
      const itemId = 'test-item-123';
      const feature = 'testFeature';
      await mockStore.setItem('testFeature:test-item-123', 'invalid-value');
      const result = await isFeatureEnabled(mockStore, itemId, feature);
      assert.strictEqual(result, false);
    });
  });

  describe('Response Decryption Feature', () => {
    it('should enable response decryption using enableResponseDecryption constant', async () => {
      const itemId = 'test-item-123';
      await setFeature(mockStore, itemId, enableResponseDecryption, true);
      const storedValue = await mockStore.getItem('enableDecryption:test-item-123');
      assert.strictEqual(storedValue, 'true');
    });

    it('should check response decryption status using enableResponseDecryption constant', async () => {
      const itemId = 'test-item-123';
      await mockStore.setItem('enableDecryption:test-item-123', 'true');
      const result = await isFeatureEnabled(mockStore, itemId, enableResponseDecryption);
      assert.strictEqual(result, true);
    });
  });

  describe('Request Encryption Feature', () => {
    it('should enable request encryption using enableRequestEncryption constant', async () => {
      const itemId = 'test-item-123';
      await setFeature(mockStore, itemId, enableRequestEncryption, true);
      const storedValue = await mockStore.getItem('enableEncryption:test-item-123');
      assert.strictEqual(storedValue, 'true');
    });

    it('should check request encryption status using enableRequestEncryption constant', async () => {
      const itemId = 'test-item-123';
      await mockStore.setItem('enableEncryption:test-item-123', 'true');
      const result = await isFeatureEnabled(mockStore, itemId, enableRequestEncryption);
      assert.strictEqual(result, true);
    });
  });
});
