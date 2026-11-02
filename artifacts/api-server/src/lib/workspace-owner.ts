export const WORKSPACE_OWNER_ID = "community-bail-research-shared-workspace";

export function isSharedWorkspaceDiscoveryOwner(ownerId: string) {
  return ownerId === WORKSPACE_OWNER_ID;
}
