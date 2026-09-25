import type * as InsomniaData from 'insomnia-data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('insomnia-data', async importOriginal => {
  const actual = await importOriginal<typeof InsomniaData>();
  return {
    ...actual,
    services: {
      ...actual.services,
      userSession: { ...actual.services.userSession, get: vi.fn() },
      project: { ...actual.services.project, list: vi.fn(), get: vi.fn() },
    },
  };
});

vi.mock('~/ui/organization-utils', () => ({
  getKonnectOrganizationEscapeRoute: vi.fn(),
}));

import { services } from 'insomnia-data';

import { getKonnectOrganizationEscapeRoute } from '~/ui/organization-utils';

import { getInitialEntry } from './router';

describe('offline initial route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([null, 'org_previous_cloud', 'org_offline', 'https://example.invalid', '{invalid json'])(
    'opens the genuine local organization regardless of stale state: %s',
    async lastVisited => {
      const storage = { getItem: vi.fn().mockReturnValue(lastVisited) };
      vi.stubGlobal('localStorage', storage);
      vi.stubGlobal('window', { localStorage: storage });
      expect(await getInitialEntry()).toBe('/organization/org_offline/project');
      expect(services.userSession.get).not.toHaveBeenCalled();
      expect(services.project.list).not.toHaveBeenCalled();
      expect(services.project.get).toHaveBeenCalledExactlyOnceWith({ parentId: 'org_offline' });
      expect(storage.getItem).toHaveBeenCalledWith('locationHistoryEntry:org_offline');
      expect(getKonnectOrganizationEscapeRoute).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
