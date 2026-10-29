import React from 'react';
import type { GetResearchOperations200 } from '@workspace/api-client-react';

export function SourceReadiness({ operations }: { operations: GetResearchOperations200 }) {
  return (
    <ul className="mt-3 space-y-1" data-testid="list-operation-readiness">
      <li data-testid="status-calendar-readiness">
        <strong>Calendar search:</strong>{' '}
        {operations.calendarEnabled
          ? 'Available for admission checks'
          : `Blocked: ${operations.calendarBlockedReason ?? 'unknown'}`}
      </li>
      <li data-testid="status-document-readiness">
        <strong>Documents/PDF retrieval:</strong>{' '}
        {operations.documentEnabled
          ? 'No current document blocker'
          : `Blocked: ${operations.documentBlockedReason ?? 'unknown'}`}
      </li>
    </ul>
  );
}
