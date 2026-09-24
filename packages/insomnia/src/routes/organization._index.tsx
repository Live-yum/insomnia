import { redirect } from 'react-router';

import { OFFLINE_ORGANIZATION_ID } from '~/common/offline';
import { getInitialRouteForOrganization } from '~/ui/utils/router';

import type { Route } from './+types/organization._index';

export async function clientLoader(_args: Route.ClientLoaderArgs) {
  return redirect(await getInitialRouteForOrganization({ organizationId: OFFLINE_ORGANIZATION_ID }));
}
