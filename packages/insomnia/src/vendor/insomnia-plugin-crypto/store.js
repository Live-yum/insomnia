const enableResponseDecryption = 'enableDecryption';
const enableRequestEncryption = 'enableEncryption';

const setFeature = async (store, itemId, feature, enable) => {
  const key = `${feature}:${itemId}`;
  await store.setItem(key, enable);
}

const isFeatureEnabled = async (store, itemId, feature) => {
  const key = `${feature}:${itemId}`;
  const storeValue = await store.getItem(key);

  return storeValue === 'true' ? true : false;
}

module.exports = {
  setFeature,
  isFeatureEnabled,
  enableRequestEncryption,
  enableResponseDecryption
};
