import type { Project } from 'insomnia-data';

// Eligibility only. The normal data service performs the parent update, keeping
// the project ID and all workspaces, environments, requests and history intact.
export function canAdoptLegacyLocalProject(project: Pick<Project, '_id' | 'parentId' | 'remoteId'>): boolean {
  return project._id !== 'proj_scratchpad' && project.parentId === null && project.remoteId === null;
}
