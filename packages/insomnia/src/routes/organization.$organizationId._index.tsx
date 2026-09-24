import { models } from 'insomnia-data';
import { redirect } from 'react-router';

import { OFFLINE_ORGANIZATION_ID } from '~/common/offline';
import { getInitialRouteForOrganization } from '~/ui/utils/router';

import type { Route } from './+types/organization.$organizationId._index';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const organizationId = params.organizationId === models.organization.SCRATCHPAD_ORGANIZATION_ID
    ? params.organizationId : OFFLINE_ORGANIZATION_ID;
  return redirect(await getInitialRouteForOrganization({ organizationId }));
}
