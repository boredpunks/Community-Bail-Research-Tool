export type SearchHistoryItem = {
  searchId: string;
  progress: {
    completed: number;
    documentsProcessed: number;
  };
};

/** Keep the latest search selected unless it has no completed evidence to show. */
export function chooseDisplayedSearchId(
  searches: readonly SearchHistoryItem[],
  requestedId?: string,
) {
  if (requestedId && searches.some((search) => search.searchId === requestedId)) return requestedId;
  const latest = searches[0];
  if (!latest) return "";
  if (latest.progress.completed > 0 || latest.progress.documentsProcessed > 0) return latest.searchId;
  return searches.find((search) =>
    search.progress.completed > 0 || search.progress.documentsProcessed > 0,
  )?.searchId ?? latest.searchId;
}
