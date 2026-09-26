import { describe, expect, it } from 'vitest';

import { canAdoptLegacyLocalProject } from '../offline-project-migration';

describe('offline legacy project adoption', () => {
  it('accepts an orphaned local project without mutating its identity', () => {
    const project = Object.freeze({ _id: 'proj_legacy', parentId: null, remoteId: null });
    expect(canAdoptLegacyLocalProject(project)).toBe(true);
    expect(project).toEqual({ _id: 'proj_legacy', parentId: null, remoteId: null });
  });

  it.each([
    { _id: 'proj_scratchpad', parentId: null, remoteId: null },
    { _id: 'proj_cloud', parentId: null, remoteId: 'team_remote' },
    { _id: 'proj_current', parentId: 'org_offline', remoteId: null },
    { _id: 'proj_other', parentId: 'org_other', remoteId: null },
  ])('does not move protected project $._id', project => {
    expect(canAdoptLegacyLocalProject(project)).toBe(false);
  });
});
