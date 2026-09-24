import type { CurrentPlan, Organization, User } from 'insomnia-api';
import { useCallback } from 'react';

import { OFFLINE_ORGANIZATION } from '~/common/offline';

/** Local organization metadata, not a fabricated server account or paid subscription. */
export function useOrganizations(): Organization[] {
  return [OFFLINE_ORGANIZATION];
}
export function useCurrentUser(): User | undefined {
  return undefined;
}
export function useCurrentPlan(): CurrentPlan | undefined {
  return undefined;
}
export function useInvalidateAccountData() {
  return useCallback(async () => {}, []);
}
