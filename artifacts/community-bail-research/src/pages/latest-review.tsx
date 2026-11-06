import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  getGetBailSearchStatusQueryKey,
  useDismissBailSearchReviewResult,
  type BailSearch,
  type BailSearchResult,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Shell, PageHead } from '@/components/shell';
import { CandidateAction } from '@/components/candidate-action';
import { errMsg } from '@/lib/money';
import { isReviewable, money, safeSourceUrl, useLatestSearch } from '@/lib/latest-search';
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

function ReviewDismissAction({ row, searchId, canManage }: { row: BailSearchResult; searchId: string; canManage: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const statusKey = getGetBailSearchStatusQueryKey(searchId);
  const dismiss = useDismissBailSearchReviewResult({
    mutation: {
      onSuccess: () => {
        setConfirm(false);
        queryClient.setQueryData(statusKey, (old: BailSearch | undefined) => old
          ? { ...old, results: old.results.map((item) => item.id === row.id ? { ...item, review_dismissed: true } : item) }
          : old);
        void queryClient.invalidateQueries({ queryKey: statusKey });
      },
      onError: (reason) => setError(errMsg(reason)),
    },
  });

  return (
    <>
      <button
        type="button"
        className="btn btn-danger btn-compact btn-icon"
        disabled={!canManage || dismiss.isPending}
        aria-label={`Delete ${row.docket_number} from Review`}
        title={canManage ? 'Remove this line from Review' : 'Only the session that started this search can remove results'}
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
              This only removes the line from Review. The search result and source evidence remain available in Search, and saved candidates are not affected.
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
                dismiss.mutate({ searchId, resultId: row.id });
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
  const { run, list, status } = useLatestSearch();
  const rows = (run?.results ?? []).filter(isReviewable);
  return (
    <Shell>
      <PageHead label="Review" title={REVIEW_TITLE}>
        <p data-testid="text-review-state">
          {REVIEW_DESCRIPTION}
        </p>
        {!run?.canManage ? (
          <p className="mt-2">Earlier searches are visible to everyone with the password; only their creating session can save or resume them.</p>
        ) : null}
      </PageHead>
      {list.isLoading ? <div className="space-y-2"><div className="skel h-6" /><div className="skel h-6" /></div> : null}
      {list.isError ? <p className="errbox" role="alert">Could not load. <button type="button" className="btn ml-2" onClick={() => list.refetch()}>Retry</button></p> : null}
      {status.isLoading ? <p className="hint" role="status">Loading latest results…</p> : null}
      {status.isError ? <p className="errbox" role="alert">Latest results could not be refreshed. <button type="button" className="btn" onClick={() => status.refetch()}>Retry</button></p> : null}
      {!list.isLoading && !run ? <p className="hint">No search yet. <Link href="/search" className="navlink">Search</Link></p> : null}
      {run && !status.isLoading && !status.isError && rows.length === 0 ? <p className="hint">{run.status === 'running' ? 'Searching. Matches appear here as they arrive.' : run.incomplete ? 'No matches yet. The latest search is incomplete.' : 'No matches in the latest search.'}</p> : null}
      {run && rows.length ? (
        <div className="bail-compare-scroll">
          <table className="bail-compare-table" style={{ minWidth: 0 }} data-testid="table-review">
            <thead><tr><th>Docket</th><th>Bail</th><th>Citation</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-testid={`row-review-${row.id}`}>
                  <th className="mono break-all">{row.docket_number}</th>
                  <td className="mono">{money(row.bail_amount)}</td>
                  <td><Citation row={row} /></td>
                  <td>
                    <div className="flex flex-wrap items-start gap-2">
                      <ReviewDismissAction row={row} searchId={run.searchId} canManage={run.canManage} />
                      <CandidateAction
                        row={row}
                        searchId={run.searchId}
                        canManage={run.canManage}
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
