import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBailSearchStatusQueryKey,
  getListBailSearchCandidatesQueryKey,
  getListBailSearchesQueryKey,
  useGetBailSearchStatus,
  useListBailSearches,
  type BailSearch,
  type BailSearchResult,
} from '@workspace/api-client-react';

/** Latest session search, shared across pages via the query cache. */
export function useLatestSearch() {
  const list = useListBailSearches({
    query: { queryKey: getListBailSearchesQueryKey(), refetchInterval: 8000, refetchOnWindowFocus: true },
  });
  const latest = list.data?.[0];
  const searchId = latest?.searchId ?? '';
  const status = useGetBailSearchStatus(searchId, {
    query: {
      queryKey: getGetBailSearchStatusQueryKey(searchId),
      enabled: !!searchId,
      refetchInterval: (query) => ((query.state.data as BailSearch | undefined)?.status === 'running' || latest?.status === 'running' ? 2000 : false),
    },
  });
  const run: BailSearch | undefined = status.data?.searchId === searchId ? status.data : latest;
  return { list, status, run, searchId };
}

/** Put a freshly launched/resumed search at the top of the cached list. */
export function usePromoteSearch() {
  const queryClient = useQueryClient();
  return (result: BailSearch) => {
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
  };
}

export function isReviewable(row: BailSearchResult) {
  return row.qualifies && row.bail_amount != null && !row.ambiguous;
}

export function money(amount: number | null | undefined) {
  return amount == null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount);
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
