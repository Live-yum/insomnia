import type * as InsomniaData from 'insomnia-data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('insomnia-data', async importOriginal => {
  const actual = await importOriginal<typeof InsomniaData>();
  return {
    ...actual,
    services: {
      ...actual.services,
      userSession: { ...actual.services.userSession, get: vi.fn() },
      project: { ...actual.services.project, list: vi.fn(), get: vi.fn(), getById: vi.fn() },
      workspace: { ...actual.services.workspace, getById: vi.fn() },
    },
  };
});
vi.mock('~/ui/organization-utils', () => ({ getKonnectOrganizationEscapeRoute: vi.fn() }));

import { services } from 'insomnia-data';

import { OFFLINE_BUILD } from '~/common/offline';
import { getKonnectOrganizationEscapeRoute } from '~/ui/organization-utils';

import { getInitialEntry } from './router';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const localStorage = { getItem: (key: string) => values.get(key) ?? null };
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('window', { localStorage });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  storage();
});

afterEach(() => {
  expect(services.userSession.get).not.toHaveBeenCalled();
  expect(services.project.list).not.toHaveBeenCalled();
  expect(getKonnectOrganizationEscapeRoute).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('real offline initial route', () => {
  it.each(['org_old_cloud', 'org_offline', 'https://example.invalid', '{invalid json'])(
    'ignores stale account/organization state: %s',
    async lastVisitedOrganizationId => {
      expect(OFFLINE_BUILD).toBe(true);
      storage({ lastVisitedOrganizationId, hasUserLoggedInBefore: 'true' });
      expect(await getInitialEntry()).toBe('/organization/org_offline/project');
      expect(services.project.get).toHaveBeenCalledWith({ parentId: 'org_offline' });
    },
  );

  it('opens a fresh profile without onboarding or an account', async () => {
    expect(await getInitialEntry()).toBe('/organization/org_offline/project');
  });

  it('restores the first local project', async () => {
    vi.mocked(services.project.get).mockResolvedValue({ _id: 'proj_local', parentId: 'org_offline' } as any);
    expect(await getInitialEntry()).toBe('/organization/org_offline/project/proj_local');
  });

  it('restores a persisted local workspace', async () => {
    storage({ 'locationHistoryEntry:org_offline': '/organization/org_offline/project/proj_local/workspace/wrk_local' });
    vi.mocked(services.project.getById).mockResolvedValue({ _id: 'proj_local', parentId: 'org_offline' } as any);
    vi.mocked(services.workspace.getById).mockResolvedValue({ _id: 'wrk_local', parentId: 'proj_local', scope: 'collection' } as any);
    expect(await getInitialEntry()).toBe('/organization/org_offline/project/proj_local/workspace/wrk_local/debug');
    expect(services.project.getById).toHaveBeenCalledWith('proj_local');
    expect(services.workspace.getById).toHaveBeenCalledWith('wrk_local');
  });

  it('does not follow a history URL for another organization', async () => {
    storage({ 'locationHistoryEntry:org_offline': '/organization/org_cloud/project/proj_cloud' });
    expect(await getInitialEntry()).toBe('/organization/org_offline/project');
    expect(services.project.getById).not.toHaveBeenCalled();
  });
});
