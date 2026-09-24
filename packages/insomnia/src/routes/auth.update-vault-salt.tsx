import { services } from 'insomnia-data';
import { type ActionFunctionArgs, href } from 'react-router';

import { createFetcherSubmitHook } from '~/ui/utils/router';

export async function clientAction(_args: ActionFunctionArgs) {
  try {
    const userSession = await services.userSession.get();
    const { vaultSalt } = userSession;
    if (vaultSalt) {
      await services.userSession.update({ vaultSalt });
      return vaultSalt;
    }
  } catch (error) {
    console.error(`failed to get vault salt ${error.toString()}`);
  }
  return;
}

export const useUpdateVaultSaltFetcher = createFetcherSubmitHook(
  submit => () => {
    return submit({}, { action: href('/auth/update-vault-salt'), method: 'POST' });
  },
  clientAction,
);
