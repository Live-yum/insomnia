import type { StorageRules } from 'insomnia-api';

import { OFFLINE_ORGANIZATION_ID } from './offline';

export const DEFAULT_STORAGE_RULES: StorageRules = {
  enableCloudSync: false,
  enableLocalVault: true,
  enableGitSync: false,
  isOverridden: false,
};

// These are local capabilities, not fabricated cloud entitlements.
export const OFFLINE_STORAGE_RULES: StorageRules = { ...DEFAULT_STORAGE_RULES, enableGitSync: true };

export async function fetchAndCacheOrganizationStorageRule(
  organizationId: string | undefined,
  _forceFetch = false,
): Promise<StorageRules> {
  return { ...(organizationId === OFFLINE_ORGANIZATION_ID ? OFFLINE_STORAGE_RULES : DEFAULT_STORAGE_RULES) };
}
