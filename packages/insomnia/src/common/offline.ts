import { models } from 'insomnia-data';

export { OFFLINE_BUILD } from './offline-policy';

export const OFFLINE_ORGANIZATION_ID = models.organization.OFFLINE_ORGANIZATION_ID;
export const OFFLINE_ORGANIZATION = models.organization.buildOfflineOrganization();
export const OFFLINE_ENTRY = `/organization/${OFFLINE_ORGANIZATION_ID}/project`;
