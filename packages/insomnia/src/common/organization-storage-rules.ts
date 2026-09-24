import type { StorageRules } from 'insomnia-api';

export const DEFAULT_STORAGE_RULES: StorageRules = {
  enableCloudSync: false,
  enableLocalVault: true,
  enableGitSync: false,
  isOverridden: false,
};

export async function fetchAndCacheOrganizationStorageRule(
  _organizationId: string | undefined,
  _forceFetch = false,
): Promise<StorageRules> {
  return { ...DEFAULT_STORAGE_RULES };
}
