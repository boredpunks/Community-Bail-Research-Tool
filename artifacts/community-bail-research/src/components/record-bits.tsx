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
      {r.discoveryEvidence ? (
        <div className="mt-3 border border-border rounded p-3" data-testid={`discovery-evidence-${r.id}`}>
          <p className="mono text-sm font-semibold">Live discovery provenance</p>
          <p className="hint break-all">Calendar: <a className="underline text-primary" href={r.discoveryEvidence.calendarUrl} target="_blank" rel="noopener noreferrer">{r.discoveryEvidence.calendarUrl}</a> retrieved {formatInstant(r.discoveryEvidence.calendarRetrievedAt)}</p>
          <p className="hint">{r.discoveryEvidence.courtOffice}; {r.discoveryEvidence.eventType}; event date {r.discoveryEvidence.eventDate ?? 'not recorded'}; extraction {r.discoveryEvidence.extractionOutcome}; posted entry state {r.discoveryEvidence.postedEntryState}</p>
          <ul className="mt-2 space-y-1 text-base">
            {r.discoveryEvidence.entries.map((e, i) => (
              <li key={i}>Entry {i + 1}: {e.action}, {e.orderDate ?? 'no date'}, {CATEGORY_LABEL[e.bailCategory]}{e.amountCents != null ? ` ${formatCents(e.amountCents)}` : ''}. <span className="hint">{e.wording}</span></li>
            ))}
            {r.discoveryEvidence.entries.length === 0 ? <li className="hint">No bail entries were extracted.</li> : null}
          </ul>
        </div>
      ) : null}
    </details>
  );
}

export function RecordSummaryLine({ r }: { r: BailRecord }) {
  return (
    <div className="text-base">
      {r.county} County, {COURT_LABEL[r.courtLevel]} &middot; {r.chargeGroup ?? 'Charge group not recorded'} &middot; {CATEGORY_LABEL[r.bailCategory]}
      {r.amountCents != null ? <> &middot; <span className="mono font-semibold">{formatCents(r.amountCents)}</span></> : null}
      {r.orderDate ? <> &middot; Order date {r.orderDate}</> : null}
    </div>
  );
}
