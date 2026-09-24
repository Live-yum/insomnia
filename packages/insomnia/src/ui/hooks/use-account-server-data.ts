import type { CurrentPlan, Organization, User } from 'insomnia-api';
import { models } from 'insomnia-data';
import { useCallback } from 'react';

const organizations: Organization[] = [models.organization.buildOfflineOrganization()];
export function useOrganizations(): Organization[] { return organizations; }
export function useCurrentUser(): User | undefined { return undefined; }
export function useCurrentPlan(): CurrentPlan | undefined { return undefined; }
export function useInvalidateAccountData() { return useCallback(async () => {}, []); }
