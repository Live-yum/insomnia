import type * as InsomniaData from 'insomnia-data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('insomnia-data', async importOriginal => {
  const actual = await importOriginal<typeof InsomniaData>();
  return {
    ...actual,
    database: { ...actual.database, find: vi.fn() },
    services: {
      ...actual.services,
      userSession: { ...actual.services.userSession, get: vi.fn() },
      project: { ...actual.services.project, list: vi.fn(), get: vi.fn(), getById: vi.fn(), update: vi.fn() },
      workspace: { ...actual.services.workspace, getById: vi.fn() },
    },
  };
});
vi.mock('~/ui/organization-utils', () => ({ getKonnectOrganizationEscapeRoute: vi.fn() }));

import { database, models, services } from 'insomnia-data';

import { OFFLINE_BUILD } from '~/common/offline';
import { CURRENT_MIGRATION_VERSION } from '~/sync/git/git-migration-version';
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
  vi.mocked(services.project.list).mockResolvedValue([]);
  vi.mocked(database.find).mockResolvedValue([]);
  vi.stubGlobal('fetch', vi.fn());
  storage();
});

afterEach(() => {
  expect(services.userSession.get).not.toHaveBeenCalled();
  expect(services.project.list).toHaveBeenCalledTimes(1);
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
    expect(database.find).not.toHaveBeenCalled();
    expect(services.project.update).not.toHaveBeenCalled();
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

  it('adopts only orphaned local records without rewriting resource IDs or cloud records', async () => {
    const legacy = { _id: 'proj_legacy', parentId: null, remoteId: null, gitRepositoryId: null, name: 'Preserve' };
    const records = [legacy,
      { ...legacy, _id: 'proj_scratchpad' },
      { ...legacy, _id: 'proj_cloud', remoteId: 'remote_project' },
      { ...legacy, _id: 'proj_other', parentId: 'org_other' },
      { ...legacy, _id: 'proj_current', parentId: 'org_offline' },
    ];
    vi.mocked(services.project.list).mockResolvedValue(records as any);
    expect(await getInitialEntry()).toBe('/organization/org_offline/project');
    expect(services.project.update).toHaveBeenCalledTimes(1);
    expect(services.project.update).toHaveBeenCalledWith(legacy, { parentId: 'org_offline' });
    expect(services.project.update.mock.invocationCallOrder[0]).toBeLessThan(services.project.get.mock.invocationCallOrder[0]);
  });

  it.each(['git_pending', 'gr_pending'])('checks required local filesystem migration for %s', async gitRepositoryId => {
    vi.mocked(services.project.list).mockResolvedValue([
      { _id: 'proj_git', parentId: 'org_offline', remoteId: null, gitRepositoryId },
    ] as any);
    vi.mocked(database.find).mockResolvedValue([{ _id: 'git_pending', repoMigrationVersion: 0 }] as any);
    expect(await getInitialEntry()).toBe('/git-migration/');
    expect(database.find).toHaveBeenCalledWith(models.gitRepository.type, { _id: { $in: ['git_pending'] } });
    expect(services.project.get).not.toHaveBeenCalled();
  });

  it('opens a fully migrated Git profile locally', async () => {
    vi.mocked(services.project.list).mockResolvedValue([
      { _id: 'proj_git', parentId: 'org_offline', remoteId: null, gitRepositoryId: 'gr_current' },
    ] as any);
    vi.mocked(database.find).mockResolvedValue([{ _id: 'git_current', repoMigrationVersion: CURRENT_MIGRATION_VERSION }] as any);
    expect(await getInitialEntry()).toBe('/organization/org_offline/project');
  });

  it('does not require migration for a Git project with no repository yet', async () => {
    vi.mocked(services.project.list).mockResolvedValue([
      { _id: 'proj_git', parentId: 'org_offline', remoteId: null, gitRepositoryId: models.project.EMPTY_GIT_PROJECT_ID },
    ] as any);
    expect(await getInitialEntry()).toBe('/organization/org_offline/project');
    expect(database.find).not.toHaveBeenCalled();
  });

  it('reports a failed local database instead of silently bypassing migration', async () => {
    vi.mocked(services.project.list).mockRejectedValue(new Error('Local database failed'));
    await expect(getInitialEntry()).rejects.toThrow('Unable to prepare local offline projects');
    expect(services.project.get).not.toHaveBeenCalled();
  });
});
