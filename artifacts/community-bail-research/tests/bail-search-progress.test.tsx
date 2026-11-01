import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BailSearch } from '@workspace/api-client-react';
import { BailSearchProgressPanel } from '../src/components/bail-search-progress';

const search = {
  searchId: 'search',
  status: 'running',
  progress: {
    completed: 0,
    total: 1,
    pending: 1,
    calendarValidated: true,
    calendarCoverage: {
      segmentsChecked: 1,
      segmentsTotal: 1,
      rowsObserved: 1,
      rowsRetained: 1,
      rowsExcluded: 0,
      partial: false,
    },
    documentsDiscovered: 1,
    documentRequestsAttempted: 1,
    documentsRetrieved: 1,
    documentsProcessed: 0,
    documentsWithEvidence: 0,
    sourceRequestsUsed: 2,
    sourceRequestLimit: 8,
    currentRequest: undefined,
    localOcr: { pagesTotal: 4, pagesAttempted: 2, pagesCompleted: 1 },
  },
  reason: null,
} as unknown as BailSearch;

const markup = renderToStaticMarkup(createElement(BailSearchProgressPanel, { search }));
assert.match(markup, /reading scanned PDF page 2 of 4/);
assert.match(markup, /2 attempted · 1 completed/);
assert.match(markup, /No court request is in flight at this instant/);
assert.match(markup, /separate from court-request timing/);
console.log('PASS: active local OCR is shown separately from court request activity.');
