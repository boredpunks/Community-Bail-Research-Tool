import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Check, RotateCcw, X } from 'lucide-react';
import {
  getListBailSearchCandidatesQueryKey,
  useListBailSearchCandidates,
  useRemoveBailSearchCandidate,
  useSetBailSearchCandidateArchive,
  useSetBailSearchCandidateOutcome,
  type BailSearchCandidate,
} from '@workspace/api-client-react';
import { Shell, PageHead } from '@/components/shell';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { errMsg } from '@/lib/money';
import { money, safeSourceUrl, shortDate } from '@/lib/latest-search';

type CandidateView = 'active' | 'archived';

const bailCategoryLabels: Record<BailSearchCandidate['bail_category'], string> = {
  MONETARY: 'Monetary bail',
  NOMINAL: 'Nominal bail',
  UNSECURED: 'Unsecured bail',
  NONMONETARY: 'Nonmonetary',
  RECOGNIZANCE: 'Recognizance',
  DENIED: 'Bail denied',
  UNKNOWN: 'Unknown bail type',
};

const courtLevelLabels: Record<BailSearchCandidate['court_level'], string> = {
  MDJ: 'Magisterial District Court',
  COMMON_PLEAS: 'Court of Common Pleas',
};

const financialBasisLabels: Record<string, string> = {
  TOTAL_BAIL: 'Total bail',
  CASH_DEPOSIT: 'Cash deposit',
  SURETY_BOND: 'Surety bond',
  RECORDED_BAIL_AMOUNT: 'Recorded bail amount',
  UNSECURED_AMOUNT: 'Unsecured amount',
};

export default function Candidates() {
  const [view, setView] = useState<CandidateView>('active');
  const [removeTarget, setRemoveTarget] = useState<{ id: string; docket_number: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const queryClient = useQueryClient();
  const afterCandidateAction = () => {
    setActionError('');
    void queryClient.invalidateQueries({ queryKey: getListBailSearchCandidatesQueryKey() });
    void queryClient.invalidateQueries({
      predicate: (query) => typeof query.queryKey[0] === 'string'
        && query.queryKey[0].startsWith('/api/bail-search/search/')
        && query.queryKey[0].endsWith('/status'),
    });
  };
  const setBailOut = useSetBailSearchCandidateOutcome({
    mutation: {
      onSuccess: afterCandidateAction,
      onError: (error) => setActionError(errMsg(error)),
    },
  });
  const setArchive = useSetBailSearchCandidateArchive({
    mutation: {
      onSuccess: afterCandidateAction,
      onError: (error) => setActionError(errMsg(error)),
    },
  });
  const removeCandidate = useRemoveBailSearchCandidate({
    mutation: {
      onSuccess: () => {
        setRemoveTarget(null);
        afterCandidateAction();
      },
      onError: (error) => setActionError(errMsg(error)),
    },
  });
  const query = useListBailSearchCandidates(
    { view },
    {
      query: {
        queryKey: getListBailSearchCandidatesQueryKey({ view }),
        refetchInterval: 8000,
        refetchOnWindowFocus: true,
      },
    },
  );
  const rows = query.data ?? [];
  const actionPending = setBailOut.isPending || setArchive.isPending || removeCandidate.isPending;
  const isArchivedView = view === 'archived';

  return (
    <Shell>
      <PageHead label="Candidates" title={isArchivedView ? 'Candidate archive' : 'Marked candidates'}>
        {isArchivedView
          ? 'Archived candidates remain available here and can be restored.'
          : 'Shared with the workspace. Mark a reported successful outcome before archiving.'}
      </PageHead>

      <div className="candidate-tabs" role="tablist" aria-label="Candidate lists">
        <button
          type="button"
          role="tab"
          id="active-candidates-tab"
          aria-controls="candidate-panel-active"
          aria-selected={!isArchivedView}
          className="candidate-tab"
          onClick={() => setView('active')}
          data-testid="tab-active-candidates"
        >
          Active candidates
        </button>
        <button
          type="button"
          role="tab"
          id="archived-candidates-tab"
          aria-controls="candidate-panel-archived"
          aria-selected={isArchivedView}
          className="candidate-tab"
          onClick={() => setView('archived')}
          data-testid="tab-archived-candidates"
        >
          Archive
        </button>
      </div>

      <div
        role="tabpanel"
        id={isArchivedView ? 'candidate-panel-archived' : 'candidate-panel-active'}
        aria-labelledby={isArchivedView ? 'archived-candidates-tab' : 'active-candidates-tab'}
        tabIndex={0}
      >
        {actionError ? <p className="errbox mb-3" role="alert">{actionError}</p> : null}
        {query.isLoading ? <div className="space-y-2"><div className="skel h-6" /><div className="skel h-6" /></div> : null}
        {query.isError ? (
          <p className="errbox" role="alert">
            {errMsg(query.error)}{' '}
            <button type="button" className="btn ml-2" onClick={() => query.refetch()} data-testid="button-retry-candidates">Retry</button>
          </p>
        ) : null}
        {!query.isLoading && query.data && rows.length === 0 ? (
          <p className="hint">{isArchivedView ? 'No archived candidates.' : 'No candidates yet.'}</p>
        ) : null}
        {rows.length ? (
          <div className="bail-compare-scroll">
            <table className="bail-compare-table" style={{ minWidth: 0 }} data-testid="table-candidates">
              <thead><tr><th>Docket</th><th>Bail</th><th>Citation</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const url = safeSourceUrl(row.source_url);
                  const markedBailedOut = row.bailed_out_at !== null;
                  const bailCategory = bailCategoryLabels[row.bail_category];
                  const financialBasis = row.financial_basis ? financialBasisLabels[row.financial_basis] ?? row.financial_basis : null;
                  const courtDetails = [row.county, courtLevelLabels[row.court_level], row.court_office]
                    .filter(Boolean).join(' · ');
                  const dateDetails = [
                    row.event_type,
                    row.event_date ? `Hearing ${shortDate(row.event_date)}` : null,
                    row.order_date ? `Order ${shortDate(row.order_date)}` : null,
                  ].filter(Boolean).join(' · ');
                  return (
                    <tr key={row.id} data-testid={`row-candidate-${row.id}`}>
                      <th className="mono break-all">
                        <div>{row.docket_number}</div>
                        <div className="candidate-glance">{courtDetails}</div>
                        {dateDetails ? <div className="candidate-glance">{dateDetails}</div> : null}
                      </th>
                      <td>
                        <div className="mono">
                          {row.bail_amount === null ? bailCategory : money(row.bail_amount)}
                        </div>
                        {row.bail_amount !== null || financialBasis || row.percentage_condition ? (
                          <div className="candidate-glance">
                            {row.bail_amount !== null ? bailCategory : null}
                            {financialBasis ? `${row.bail_amount !== null ? ' · ' : ''}${financialBasis}` : null}
                            {row.percentage_condition ? `${row.bail_amount !== null || financialBasis ? ' · ' : ''}${row.percentage_condition}` : null}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div className="candidate-source-details">
                          {url
                            ? <a href={url} target="_blank" rel="noopener noreferrer" className="navlink" data-testid={`link-candidate-pdf-${row.id}`}>Open original PDF{row.evidence_page != null ? ` · p. ${row.evidence_page}` : ''}</a>
                            : <span className="hint">Original PDF link unavailable</span>}
                          <div className="candidate-glance">{row.source_title}</div>
                          <p className="candidate-evidence-quote" title={row.evidence_quote}>{row.evidence_quote}</p>
                        </div>
                      </td>
                      <td className="align-top">
                        <div className="candidate-actions">
                          <button
                            type="button"
                            className="btn btn-danger btn-compact btn-icon"
                            disabled={actionPending}
                            aria-label={`Delete ${row.docket_number} from candidates`}
                            title="Delete this candidate from the shared list"
                            onClick={() => {
                              setActionError('');
                              removeCandidate.reset();
                              setRemoveTarget({ id: row.id, docket_number: row.docket_number });
                            }}
                            data-testid={`button-delete-candidate-${row.id}`}
                          >
                            <X aria-hidden="true" size={18} />
                          </button>
                          {isArchivedView ? (
                            <button
                              type="button"
                              className="btn btn-compact candidate-restore-button"
                              disabled={actionPending}
                              aria-label={`Restore ${row.docket_number} to active candidates`}
                              title="Restore to active candidates"
                              onClick={() => setArchive.mutate({ candidateId: row.id, data: { archived: false } })}
                              data-testid={`button-restore-candidate-${row.id}`}
                            >
                              <RotateCcw aria-hidden="true" size={16} />
                              <span>Restore</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={`btn btn-compact btn-icon candidate-check-button${markedBailedOut ? ' candidate-check-button-marked' : ''}`}
                              disabled={actionPending}
                              aria-label={markedBailedOut ? `Undo successful bail-out mark for ${row.docket_number}` : `Mark ${row.docket_number} as successfully bailed out`}
                              aria-pressed={markedBailedOut}
                              title={markedBailedOut ? 'Undo successful-outcome mark' : 'Mark as successfully bailed out'}
                              onClick={() => setBailOut.mutate({ candidateId: row.id, data: { bailedOut: !markedBailedOut } })}
                              data-testid={`button-mark-bailed-out-${row.id}`}
                            >
                              <Check aria-hidden="true" size={18} />
                            </button>
                          )}
                        </div>
                        {markedBailedOut ? (
                          <div className="candidate-outcome mt-2" role="status" data-testid={`status-bailed-out-${row.id}`}>
                            <span>{isArchivedView ? 'Reported successful bail-out' : 'Candidate successfully bailed out! Archive?'}</span>
                            {!isArchivedView ? (
                              <button
                                type="button"
                                className="btn btn-primary btn-compact"
                                disabled={actionPending}
                                onClick={() => setArchive.mutate({ candidateId: row.id, data: { archived: true } })}
                                data-testid={`button-archive-candidate-${row.id}`}
                              >
                                <Archive aria-hidden="true" size={15} />
                                <span>Archive?</span>
                              </button>
                            ) : <span className="tag">Archived</span>}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => { if (!removeCandidate.isPending && !open) setRemoveTarget(null); }}>
        <AlertDialogContent className="border-primary bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="mono">Delete this candidate?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {removeTarget?.docket_number ?? 'this candidate'} from both candidate lists? The source-backed observation and any review history will be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeCandidate.isError ? <p className="errbox" role="alert">{actionError || errMsg(removeCandidate.error)}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="btn" disabled={removeCandidate.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="btn btn-danger"
              disabled={removeCandidate.isPending || !removeTarget}
              onClick={(event) => {
                event.preventDefault();
                if (removeTarget) removeCandidate.mutate({ candidateId: removeTarget.id });
              }}
              data-testid="button-confirm-delete-candidate"
            >
              {removeCandidate.isPending ? 'Deleting…' : 'Delete candidate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
