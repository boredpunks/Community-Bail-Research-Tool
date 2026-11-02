export type SearchHistoryItem = {
  searchId: string;
  status?: string;
  progress: {
    completed: number;
    documentsProcessed: number;
  };
};

const LAST_STARTED_SEARCH = 'bail-research:last-started-search';

export function lastStartedSearchId(): string | undefined {
  try { return sessionStorage.getItem(LAST_STARTED_SEARCH) ?? undefined; }
  catch { return undefined; }
}

export function rememberStartedSearch(searchId: string) {
  try { sessionStorage.setItem(LAST_STARTED_SEARCH, searchId); }
  catch { /* Server history remains authoritative when browser storage is unavailable. */ }
}

export function forgetStartedSearch() {
  try { sessionStorage.removeItem(LAST_STARTED_SEARCH); }
  catch { /* Server history remains authoritative when browser storage is unavailable. */ }
}

export function clearSearchSelection() {
  try { sessionStorage.setItem(LAST_STARTED_SEARCH, ''); }
  catch { /* The visible results selection can still be cleared for this page. */ }
}

/** Prefer an active or resumable latest search; otherwise preserve useful evidence from history. */
export function chooseDisplayedSearchId(
  searches: readonly SearchHistoryItem[],
  requestedId?: string,
) {
  if (requestedId === '') return '';
  if (requestedId && searches.some((search) => search.searchId === requestedId)) return requestedId;
  const latest = searches[0];
  if (!latest) return "";
  if (latest.status === "running" || latest.status === "paused") return latest.searchId;
  if (latest.progress.completed > 0 || latest.progress.documentsProcessed > 0) return latest.searchId;
  return searches.find((search) =>
    search.progress.completed > 0 || search.progress.documentsProcessed > 0,
  )?.searchId ?? latest.searchId;
}
