import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListBailRecords,
  useReviewBailRecord,
  getListBailRecordsQueryKey,
  getGetBailRangeQueryKey,
  type BailRecord,
  type BailReviewInputOrderInterpretation,
} from '@workspace/api-client-react';
import { Shell, PageHead } from '@/components/shell';
import { EvidenceDetails, RecordSummaryLine, StatusTag } from '@/components/record-bits';
import { errMsg } from '@/lib/money';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const INTERP_LABEL: Record<BailReviewInputOrderInterpretation, string> = {
  UNRESOLVED: 'Unresolved (safe default)',
  REVIEWED_OPERATIVE: 'Reviewed as the operative order',
  SUPERSEDED: 'Superseded by a later order',
};

function ReviewCard({ r }: { r: BailRecord }) {
  const qc = useQueryClient();
  const review = useReviewBailRecord();
  const [comment, setComment] = useState('');
  const [interp, setInterp] = useState<BailReviewInputOrderInterpretation>('UNRESOLVED');
  const [pending, setPending] = useState<'CONFIRMED' | 'REJECTED' | null>(null);
  const needsDate = interp === 'REVIEWED_OPERATIVE' && !r.orderDate;
  const decide = (decision: 'CONFIRMED' | 'REJECTED') =>
    review.mutate(
      { recordId: r.id, data: { decision, orderInterpretation: decision === 'REJECTED' ? 'UNRESOLVED' : interp, comment: comment.trim() || null } },
      {
        onSuccess: () => setPending(null),
        onSettled: () => {
          qc.invalidateQueries({ queryKey: getListBailRecordsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetBailRangeQueryKey() });
        },
      },
    );
  return (
    <li className="panel" data-testid={`card-review-${r.id}`}>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="mono font-bold select-all break-all">{r.docketNumber}</span>
        <StatusTag status={r.reviewStatus} />
      </div>
      <RecordSummaryLine r={r} />
      <div className="my-3"><EvidenceDetails r={r} /></div>
      <p className="hint mb-3">Open the source link and check each field against it before deciding.</p>
      <fieldset className="mb-4">
        <legend className="lbl">Which order is operative? (separate from confirming the source)</legend>
        <p className="hint mb-2">Confirming means the entry matches what the source says. It does not by itself say this is the order currently in effect. Used only if you confirm; rejecting records Unresolved.</p>
        {([
          ['UNRESOLVED', 'Unresolved: I cannot tell which order is operative'],
          ['REVIEWED_OPERATIVE', 'This is the operative order (requires an order date; only one per docket)'],
          ['SUPERSEDED', 'This order was superseded by a later order'],
        ] as const).map(([v, l]) => (
          <label key={v} className="flex gap-3 items-start py-1 cursor-pointer">
            <input type="radio" className="mt-1.5 h-5 w-5" name={`interp-${r.id}`} checked={interp === v} onChange={() => setInterp(v)} data-testid={`radio-${v.toLowerCase()}-${r.id}`} />
            <span>{l}</span>
          </label>
        ))}
        {needsDate ? <p className="errbox mt-2" role="alert">This record has no order date, so it cannot be reviewed as the operative order.</p> : null}
      </fieldset>
      <label className="lbl" htmlFor={`c-${r.id}`}>Review comment (optional)</label>
      <textarea id={`c-${r.id}`} className="field" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} data-testid={`input-comment-${r.id}`} />
      {review.isError ? <p className="errbox mt-3" role="alert">{errMsg(review.error)}</p> : null}
      <div className="flex flex-wrap gap-3 mt-3">
        <button type="button" className="btn btn-primary" disabled={review.isPending || needsDate} onClick={() => setPending('CONFIRMED')} data-testid={`button-confirm-${r.id}`}>CONFIRM AGAINST SOURCE</button>
        <button type="button" className="btn btn-danger" disabled={review.isPending} onClick={() => setPending('REJECTED')} data-testid={`button-reject-${r.id}`}>REJECT RECORD</button>
      </div>
      <AlertDialog open={pending != null} onOpenChange={(open) => { if (!open && !review.isPending) setPending(null); }}>
        <AlertDialogContent className="border-primary bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="mono">{pending === 'CONFIRMED' ? 'Confirm against source?' : 'Reject this record?'}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-foreground">
                <p className="mono break-all">{r.docketNumber}</p>
                {pending === 'CONFIRMED' ? (
                  <>
                    <p>You are stating that this entry matches what its source document says.</p>
                    <p>Order interpretation: <strong>{INTERP_LABEL[interp]}</strong>. Interpretation is a separate judgment about which order applies; confirming the source does not make an order operative on its own.</p>
                  </>
                ) : (
                  <p>The record will be rejected and its order interpretation recorded as Unresolved. The submitted evidence is kept, not overwritten.</p>
                )}
                <p className="hint">This decision is final and cannot be undone here. The workspace uses one shared password, so it is not attributed to an individual reviewer.</p>
                {review.isError ? <p className="errbox" role="alert">{errMsg(review.error)}</p> : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="btn" disabled={review.isPending} data-testid={`button-cancel-decision-${r.id}`}>Go back</AlertDialogCancel>
            <AlertDialogAction
              className={`btn ${pending === 'REJECTED' ? 'btn-danger' : 'btn-primary'}`}
              disabled={review.isPending}
              onClick={(event) => { event.preventDefault(); if (pending) decide(pending); }}
              data-testid={`button-final-decision-${r.id}`}
            >
              {review.isPending ? 'Recording…' : pending === 'CONFIRMED' ? 'Yes, confirm (final)' : 'Yes, reject (final)'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export default function Review() {
  const list = useListBailRecords({ reviewStatus: 'PENDING' }, { query: { queryKey: getListBailRecordsQueryKey({ reviewStatus: 'PENDING' }), refetchOnMount: 'always' } });
  const records = list.data?.records ?? [];
  return (
    <Shell>
      <PageHead label="Review queue" title="Review pending source evidence">
        Compare each entry with its linked source. Confirming marks the entry as matching its source; it does not make the order operative. Ranges use only confirmed, reviewed-operative numeric entries in the selected category and financial basis. Leaving the operative order unresolved keeps the entry out of those ranges. Decisions are final and do not overwrite the submitted evidence.
      </PageHead>
      <section className="panel mb-5" data-testid="section-review-guide">
        <p className="bracket">Before you decide</p>
        <ul className="hint mt-2 space-y-1 list-disc pl-5">
          <li><strong>Saving</strong> put this docket in the shared workspace. It is not a confirmation.</li>
          <li><strong>Confirming a source match</strong> means each field agrees with the linked source document.</li>
          <li><strong>Interpreting the order</strong> is a separate judgment about which order applies. Leave it Unresolved unless the source makes it clear; Unresolved is the safe default.</li>
          <li>Anyone with the shared password can review. There are no individual reviewer accounts, so decisions are not attributed to a person. Review only what you can check against the source yourself.</li>
        </ul>
      </section>
      {list.isLoading ? (
        <div className="space-y-3" aria-busy="true"><div className="skel h-32" /><div className="skel h-32" /></div>
      ) : list.isError ? (
        <div className="errbox" role="alert">
          <p>Could not load the queue. {errMsg(list.error)}</p>
          <button type="button" className="btn btn-danger mt-3" onClick={() => list.refetch()} data-testid="button-retry-review">Retry</button>
        </div>
      ) : records.length === 0 ? (
        <div className="panel grid-bg" data-testid="empty-review">
          <div className="bg-card p-4 max-w-2xl">
            <p className="mono font-bold text-lg">Nothing is waiting for review.</p>
            <p className="mt-2">Entries appear here after someone saves a source-backed observation.</p>
            <Link href="/records/new" className="btn mt-4" data-testid="link-enter-record">Enter a record</Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-4">{records.map((r) => <ReviewCard key={r.id} r={r} />)}</ul>
      )}
    </Shell>
  );
}
