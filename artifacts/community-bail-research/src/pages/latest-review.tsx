import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  getGetBailSearchStatusQueryKey,
  getListBailSearchReviewQueueQueryKey,
  useListBailSearchReviewQueue,
  useDismissBailSearchReviewResult,
  type BailSearch,
  type BailSearchResult,
  type BailSearchReviewItem,
} from '@workspace/api-client-react';
import { Shell, PageHead } from '@/components/shell';
import { CandidateAction } from '@/components/candidate-action';
import { errMsg } from '@/lib/money';
import { isReviewable, money, safeSourceUrl, shortDate } from '@/lib/latest-search';
import { CANDIDATE_SAVE_LABEL, CANDIDATE_SAVED_LABEL, REVIEW_DESCRIPTION, REVIEW_TITLE } from '@/lib/workflow-copy';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function Citation({ row }: { row: BailSearchResult }) {
  const url = safeSourceUrl(row.source_url);
  const page = row.evidence_page != null ? `p. ${row.evidence_page}` : 'page not recorded';
  if (!url) return <span className="hint">PDF link unavailable</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="navlink" data-testid={`link-pdf-${row.id}`}>PDF, {page}</a>;
}

function ReviewDismissAction({ row }: { row: BailSearchReviewItem }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const statusKey = getGetBailSearchStatusQueryKey(row.search_id);
  const dismiss = useDismissBailSearchReviewResult({
    mutation: {
      onSuccess: () => {
        setConfirm(false);
        queryClient.setQueryData(statusKey, (old: BailSearch | undefined) => old
          ? { ...old, results: old.results.map((item) => item.id === row.id ? { ...item, review_dismissed: true } : item) }
          : old);
        void queryClient.invalidateQueries({ queryKey: statusKey });
        void queryClient.invalidateQueries({ queryKey: getListBailSearchReviewQueueQueryKey() });
      },
      onError: (reason) => setError(errMsg(reason)),
    },
  });

  return (
    <>
      <button
        type="button"
        className="btn btn-danger btn-compact btn-icon"
        disabled={dismiss.isPending}
        aria-label={`Delete ${row.docket_number} from Review`}
        title="Any workspace user can remove this docket from shared Review"
        onClick={() => { setError(''); dismiss.reset(); setConfirm(true); }}
        data-testid={`button-dismiss-review-${row.id}`}
      >
        <X aria-hidden="true" size={18} />
      </button>
      <AlertDialog open={confirm} onOpenChange={(open) => { if (!dismiss.isPending) setConfirm(open); }}>
        <AlertDialogContent className="border-primary bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="mono">Delete this line from Review?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the docket from the shared Review list. Search history, source evidence, and any saved candidate remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="errbox" role="alert">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="btn" disabled={dismiss.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="btn btn-danger"
              disabled={dismiss.isPending}
              onClick={(event) => {
                event.preventDefault();
                dismiss.mutate({ searchId: row.search_id, resultId: row.id });
              }}
              data-testid={`button-confirm-dismiss-review-${row.id}`}
            >
              {dismiss.isPending ? 'Deleting…' : 'Delete from Review'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function LatestReview() {
  const query = useListBailSearchReviewQueue({
    query: {
      queryKey: getListBailSearchReviewQueueQueryKey(),
      refetchInterval: 8000,
      refetchOnWindowFocus: true,
    },
  });
  const rows = (query.data ?? []).filter(isReviewable);
  return (
    <Shell>
      <PageHead label="Review" title={REVIEW_TITLE}>
        <p data-testid="text-review-state">
          {REVIEW_DESCRIPTION}
        </p>
      </PageHead>
      {query.isLoading ? <div className="space-y-2"><div className="skel h-6" /><div className="skel h-6" /></div> : null}
      {query.isError ? <p className="errbox" role="alert">Could not load shared Review. <button type="button" className="btn ml-2" onClick={() => query.refetch()}>Retry</button></p> : null}
      {!query.isLoading && !query.isError && rows.length === 0 ? (
        <p className="hint">No dockets are currently in shared Review. New reviewable matches appear here as searches finish.</p>
      ) : null}
      {rows.length ? (
        <div className="bail-compare-scroll">
          <table className="bail-compare-table" style={{ minWidth: 0 }} data-testid="table-review">
            <thead><tr><th>Docket</th><th>Bail</th><th>Citation</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.search_id}:${row.id}`} data-testid={`row-review-${row.id}`}>
                  <th className="mono break-all">
                    <div>{row.docket_number}</div>
                    <div className="candidate-glance">Search {shortDate(row.search_created_at)}</div>
                  </th>
                  <td className="mono">{money(row.bail_amount)}</td>
                  <td><Citation row={row} /></td>
                  <td>
                    <div className="flex flex-wrap items-start gap-2">
                      <ReviewDismissAction row={row} />
                      <CandidateAction
                        row={row}
                        searchId={row.search_id}
                        canManage={row.can_manage}
                        buttonLabel={CANDIDATE_SAVE_LABEL}
                        savedLabel={CANDIDATE_SAVED_LABEL}
                        blue
                        showDisabledButton
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Shell>
  );
}
