import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBailSearchStatusQueryKey,
  getListBailSearchCandidatesQueryKey,
  getListBailSearchReviewQueueQueryKey,
  getListBailSearchesQueryKey,
  useGetBailSearchStatus,
  useListBailSearches,
  type BailSearch,
  type BailSearchResult,
} from '@workspace/api-client-react';
import { chooseDisplayedSearchId, rememberStartedSearch } from '@/lib/search-history';

/** Latest useful search, with older evidence retained when the newest is empty. */
export function useLatestSearch(requestedSearchId?: string) {
  const list = useListBailSearches({
    query: { queryKey: getListBailSearchesQueryKey(), refetchInterval: 8000, refetchOnWindowFocus: true },
  });
  const searches = list.data ?? [];
  const latest = searches[0];
  const searchId = chooseDisplayedSearchId(searches, requestedSearchId);
  const selected = searches.find((item) => item.searchId === searchId);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (searchId && selected?.updatedAt) {
      void queryClient.invalidateQueries({ queryKey: getGetBailSearchStatusQueryKey(searchId) });
    }
  }, [queryClient, searchId, selected?.updatedAt]);
  const status = useGetBailSearchStatus(searchId, {
    query: {
      queryKey: getGetBailSearchStatusQueryKey(searchId),
      enabled: !!searchId,
      refetchInterval: (query) => ((query.state.data as BailSearch | undefined)?.status === 'running' || selected?.status === 'running' ? 2000 : false),
    },
  });
  const run: BailSearch | undefined = status.data?.searchId === searchId ? status.data : selected;
  return { list, status, run, latest, searchId };
}

/** Put a freshly launched/resumed search at the top of the cached list. */
export function usePromoteSearch() {
  const queryClient = useQueryClient();
  return (result: BailSearch) => {
    rememberStartedSearch(result.searchId);
    queryClient.setQueryData(getGetBailSearchStatusQueryKey(result.searchId), result);
    queryClient.setQueryData(getListBailSearchesQueryKey(), (old: BailSearch[] | undefined) =>
      [result, ...(old ?? []).filter((item) => item.searchId !== result.searchId)]);
    queryClient.invalidateQueries({ queryKey: getListBailSearchesQueryKey() });
  };
}

export function useAfterCandidateSave(searchId: string) {
  const queryClient = useQueryClient();
  return (updated: BailSearchResult) => {
    queryClient.setQueryData(getGetBailSearchStatusQueryKey(searchId), (old: BailSearch | undefined) =>
      old ? { ...old, results: old.results.map((item) => item.id === updated.id ? { ...item, ...updated } : item) } : old);
    queryClient.invalidateQueries({ queryKey: getGetBailSearchStatusQueryKey(searchId) });
    queryClient.invalidateQueries({ queryKey: getListBailSearchCandidatesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListBailSearchReviewQueueQueryKey() });
  };
}

export function isReviewable(row: BailSearchResult) {
  return row.qualifies && row.bail_amount != null && !row.ambiguous && !row.review_dismissed;
}

export function money(amount: number | null | undefined) {
  return amount == null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount);
}

export function bailDisplay(row: Pick<BailSearchResult, 'bail_amount' | 'classification' | 'document_status'>) {
  if (row.bail_amount != null) return money(row.bail_amount);
  if (row.classification === 'denied') return 'Bail denied';
  if (row.classification === 'nonmonetary') return 'Nonmonetary';
  if (row.classification === 'recognizance') return 'Recognizance';
  if (row.document_status === 'NO_BAIL_SECTION') return 'No bail section';
  if (['NOT_REQUESTED', 'REQUEST_IN_PROGRESS', 'RETRIEVED'].includes(row.document_status)) return 'Pending PDF';
  return 'Not established';
}

export function shortDate(value: string | null | undefined) {
  if (!value) return '';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

export function safeSourceUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
