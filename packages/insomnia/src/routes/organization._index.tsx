import { redirect } from 'react-router';

import { OFFLINE_ORGANIZATION_ID } from '~/common/offline';

export async function clientLoader() {
  return redirect(`/organization/${OFFLINE_ORGANIZATION_ID}/project`);
}
