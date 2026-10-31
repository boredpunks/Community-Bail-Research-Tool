export function canManageSearch(searchOwnerId: string, viewerOwnerId: string) {
  return searchOwnerId === viewerOwnerId;
}

export function withSearchViewerAccess<T extends { resumeToken: string | null }>(
  response: T,
  searchOwnerId: string,
  viewerOwnerId: string,
) {
  const canManage = canManageSearch(searchOwnerId, viewerOwnerId);
  return {
    ...response,
    canManage,
    resumeToken: canManage ? response.resumeToken : null,
  };
}
