import { type BailRecord } from '@workspace/api-client-react';
import { BASIS_LABEL, CATEGORY_LABEL, COURT_LABEL, formatCents, formatInstant } from '@/lib/money';

const INTERP: Record<string, string> = {
  UNREVIEWED: 'Not yet reviewed',
  REVIEWED_OPERATIVE: 'Reviewed as the operative order',
  SUPERSEDED: 'Reviewed as superseded by another order',
  UNRESOLVED: 'Operative order unresolved',
};

export function StatusTag({ status }: { status: BailRecord['reviewStatus'] }) {
  if (status === 'CONFIRMED')
    return <span className="tag text-primary">Reviewed: source confirmed</span>;
  if (status === 'REJECTED')
    return <span className="tag text-destructive">Rejected in review</span>;
  return <span className="tag text-warning">Needs review</span>;
}

export function EvidenceDetails({ r }: { r: BailRecord }) {
  return (
    <details className="mt-1" data-testid={`details-${r.id}`}>
      <summary className="cursor-pointer mono font-semibold text-primary">Source and evidence</summary>
      <dl className="mt-3 grid gap-2 text-base md:grid-cols-[12rem_1fr]">
        <dt className="mono text-sm">Source title</dt><dd>{r.sourceTitle}</dd>
        <dt className="mono text-sm">Source link</dt>
        <dd className="break-all"><a className="underline text-primary" href={r.sourceUrl} target="_blank" rel="noopener noreferrer">{r.sourceUrl}</a></dd>
        <dt className="mono text-sm">Source consulted</dt><dd>{formatInstant(r.sourceRetrievedAt)}</dd>
        <dt className="mono text-sm">Source's own as-of time</dt><dd>{formatInstant(r.sourceObservedAt)}</dd>
        <dt className="mono text-sm">Bail category</dt><dd>{CATEGORY_LABEL[r.bailCategory]}</dd>
        <dt className="mono text-sm">Financial basis</dt><dd>{r.financialBasis ? BASIS_LABEL[r.financialBasis] : 'Not applicable'}</dd>
        <dt className="mono text-sm">Evidence note</dt><dd className="whitespace-pre-wrap">{r.evidenceNote}</dd>
        <dt className="mono text-sm">Order interpretation</dt><dd>{INTERP[r.orderInterpretation]}</dd>
        <dt className="mono text-sm">Entered</dt><dd>{formatInstant(r.createdAt)}</dd>
        {r.reviewedAt ? (<><dt className="mono text-sm">Reviewed</dt><dd>{formatInstant(r.reviewedAt)}</dd></>) : null}
        {r.reviewComment ? (<><dt className="mono text-sm">Review comment</dt><dd className="whitespace-pre-wrap">{r.reviewComment}</dd></>) : null}
      </dl>
    </details>
  );
}

export function RecordSummaryLine({ r }: { r: BailRecord }) {
  return (
    <div className="text-base">
      {r.county} County, {COURT_LABEL[r.courtLevel]} &middot; {r.chargeGroup} &middot; {CATEGORY_LABEL[r.bailCategory]}
      {r.amountCents != null ? <> &middot; <span className="mono font-semibold">{formatCents(r.amountCents)}</span></> : null}
      {r.orderDate ? <> &middot; Order date {r.orderDate}</> : null}
    </div>
  );
}
