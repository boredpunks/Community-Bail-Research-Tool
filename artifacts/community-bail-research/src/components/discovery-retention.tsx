import React from 'react';
import type { DiscoveryItem } from '@workspace/api-client-react';

type RetainedJob = {
  status: string;
  isAssessment?: boolean;
  resultsExpiredAt?: string | null;
};

export function ExpiredResultsNotice({ resultsExpiredAt, items }: {
  resultsExpiredAt?: string | null;
  items: readonly DiscoveryItem[];
}) {
  if (!resultsExpiredAt) return null;
  return (
    <>
      <p className="errbox mt-2" role="status" data-testid="text-results-expired">
        This checkpoint expired after 24 hours and cannot resume or replay collection.
        {' '}Dockets already in shared Review and Candidates remain until a workspace user deletes them.
        {' '}Historical counts and request use remain{items.length === 0 ? '' : `; ${items.length} remaining Discovery rows are read-only`}.
      </p>
      {items.length === 0 ? (
        <p className="hint border border-dashed border-border rounded p-4" data-testid="empty-items">
          Expired search results are no longer shown; this empty list does not indicate that the calendar had no matching dockets.
        </p>
      ) : null}
    </>
  );
}

export function ResumeControl({ job, pending, collectionEnabled, onResume }: {
  job: RetainedJob | undefined;
  pending: boolean;
  collectionEnabled: boolean;
  onResume: () => void;
}) {
  const canResume = !job?.isAssessment && !job?.resultsExpiredAt
    && (job?.status === 'PAUSED' || job?.status === 'CANCELLED' || job?.status === 'FAILED');
  if (!canResume) return null;
  return (
    <button type="button" className="btn btn-primary" disabled={pending || !collectionEnabled}
      onClick={onResume} data-testid="button-resume">Resume</button>
  );
}
