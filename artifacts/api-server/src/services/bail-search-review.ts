export const BAIL_SEARCH_WORKSPACE_LOCK_KEY = "workspace-wide-bail-search-history";

export function partitionSearchesForHistoryClear<T extends { id: string }>(
  searches: readonly T[],
  activeReviewSearchIds: ReadonlySet<string>,
) {
  return {
    retainedReview: searches.filter(search => activeReviewSearchIds.has(search.id)),
    clearable: searches.filter(search => !activeReviewSearchIds.has(search.id)),
  };
}

export function planWorkspaceSearchHistoryClear<
  T extends { id: string; discoveryJobId: string | null; status: string },
>(searches: readonly T[], activeReviewSearchIds: ReadonlySet<string>) {
  const { retainedReview, clearable } = partitionSearchesForHistoryClear(searches, activeReviewSearchIds);
  return {
    retainedReview,
    clearable,
    linkedJobIds: [...new Set(searches.flatMap(search => search.discoveryJobId ? [search.discoveryJobId] : []))],
    runningSearchIds: searches.filter(search => search.status === "running").map(search => search.id),
  };
}
