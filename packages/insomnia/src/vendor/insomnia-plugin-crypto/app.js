const { Buffer } = require('buffer');

const {
  setFeature,
  isFeatureEnabled,
  enableRequestEncryption,
  enableResponseDecryption
} = require('./store');

const {
  encrypt,
  decrypt,
} = require('./encrypt');

const ALGORITHM_ENV = 'crypto-alg';
const KEY_ENV = 'crypto-key';
const USE_BASE64 = 'crypto-base64';

const alertOnMissingEnvConfig = (title, context) => {
  console.error(`${title}: Missing algorithm or key in environment`);
  context.app.alert(title, 'Missing algorithm or key in environment variables. '
    + `Please set the following environment variables: '${ALGORITHM_ENV}' '${KEY_ENV}'`);
};

module.exports.responseHooks = [
  async (context) => {
    const enabled = await isFeatureEnabled(context.store, context.request.getId(), enableResponseDecryption);
    if (enabled) {
      const algorithm = context.request.getEnvironmentVariable(ALGORITHM_ENV);
      const key = context.request.getEnvironmentVariable(KEY_ENV);

      if (!algorithm || !key) {
        throw new Error('Response decryption requires crypto-alg and crypto-key.');
      }

      const useBase64 = context.request.getEnvironmentVariable(USE_BASE64) ?? true;
      if (useBase64 !== true) throw new Error('Offline Crypto requires crypto-base64=true to avoid binary corruption.');
      try {
        const bodyBuffer = await context.response.getBody();
        const body = useBase64 ? Buffer.from(bodyBuffer.toString('utf-8'), 'base64') : bodyBuffer;

        const decryptedBody = decrypt(body, algorithm, key);
        context.response.setBody(decryptedBody);
      } catch (error) {
        throw new Error('Response decryption failed.', { cause: error });
      }
    }
  }
];

module.exports.requestHooks = [
  async (context) => {
    const enabled = await isFeatureEnabled(context.store, context.request.getId(), enableRequestEncryption);
    if (enabled) {
      const algorithm = context.request.getEnvironmentVariable(ALGORITHM_ENV);
      const key = context.request.getEnvironmentVariable(KEY_ENV);

      if (!algorithm || !key) {
        throw new Error('Encryption required: configure crypto-alg and crypto-key before sending.');
      }

      const useBase64 = context.request.getEnvironmentVariable(USE_BASE64) ?? true;
      if (useBase64 !== true) throw new Error('Offline Crypto requires crypto-base64=true to avoid binary corruption.');
      try {
        const encryptedBody = encrypt(context.request.getBody().text, algorithm, key);
        context.request.setBody({ text: encryptedBody.toString(useBase64 ? 'base64' : 'binary') });
      } catch (error) {
        throw new Error('Request encryption failed; nothing was sent.', { cause: error });
      }
    }
  }
];

module.exports.requestActions = [
  {
    label: 'Toggle Response Decryption',
    action: async (context, data) => {
      const { store } = context;
      const { request } = data;

      const currentState = await isFeatureEnabled(store, request._id, enableResponseDecryption);

      const newState = !currentState;
      await setFeature(store, request._id, enableResponseDecryption, newState);

      context.app.alert('Crypto', `Response decryption ${newState ? 'enabled' : 'disabled'} for this request`);
    }
  },
  {
    label: 'Toggle Request Encryption',
    action: async (context, data) => {
      const { store } = context;
      const { request } = data;

      const currentState = await isFeatureEnabled(store, request._id, enableRequestEncryption);

      const newState = !currentState;
      await setFeature(store, request._id, enableRequestEncryption, newState);

      context.app.alert('Crypto', `Request encryption ${newState ? 'enabled' : 'disabled'} for this request`);
    }
  }
];
