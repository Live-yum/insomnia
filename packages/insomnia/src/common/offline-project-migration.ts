// Eligibility only. The normal data service performs the parent update, keeping
// the project ID and all workspaces, environments, requests and history intact.
export function canAdoptLegacyLocalProject(project: Readonly<{ _id: string; parentId: string | null; remoteId: string | null }>): boolean {
  return project._id !== 'proj_scratchpad' && project.parentId === null && project.remoteId === null;
}
