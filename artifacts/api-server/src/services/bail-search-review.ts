export function partitionSearchesForHistoryClear<T extends { id: string }>(
  searches: readonly T[],
  activeReviewSearchIds: ReadonlySet<string>,
) {
  return {
    retainedReview: searches.filter(search => activeReviewSearchIds.has(search.id)),
    clearable: searches.filter(search => !activeReviewSearchIds.has(search.id)),
  };
}
