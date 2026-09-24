import { href } from 'react-router';

import { createFetcherSubmitHook } from '~/ui/utils/router';

import type { Route } from './+types/auth.clear-vault-key';

export async function clientAction(_args: Route.ClientActionArgs) {
  // Cloud-originated reset notifications must never delete an offline user's secrets.
  return false;
}

export const useClearVaultKeyFetcher = createFetcherSubmitHook(
  submit => (data: { organizations: string[]; sessionId: string }) => {
    submit(data, {
      action: href('/auth/clear-vault-key'),
      method: 'POST',
      encType: 'application/json',
    });
  },
  clientAction,
);
