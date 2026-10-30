import React from 'react';
import type { BailSearchResultDocumentTimings } from '@workspace/api-client-react';

function formatDuration(milliseconds: number | null | undefined) {
  if (milliseconds == null) return 'Not recorded';
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

export function DocumentTimingDetails({ timings }: { timings?: BailSearchResultDocumentTimings | null }) {
  if (!timings || Object.values(timings).every(value => value == null)) return null;
  return (
    <p className="hint">
      PDF timing: slot wait {formatDuration(timings.slot_wait_ms)}
      {' · '}request/response {formatDuration(timings.retrieval_ms)}
      {' · '}local extraction {formatDuration(timings.extraction_ms)}
      {' · '}evidence save {formatDuration(timings.persistence_ms)}
    </p>
  );
}
