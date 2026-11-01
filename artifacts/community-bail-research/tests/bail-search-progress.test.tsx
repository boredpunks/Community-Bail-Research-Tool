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
    timeline: [{
      id: 'request-1', at: new Date().toISOString(), label: 'GET · Loaded a court calendar resource',
      detail: 'HTTP 200 · source outcome OK', status: 'completed', durationMs: 1_500,
    }],
  },
  reason: null,
  createdAt: new Date().toISOString(),
} as unknown as BailSearch;

const markup = renderToStaticMarkup(createElement(BailSearchProgressPanel, { search }));
assert.match(markup, /reading scanned PDF page 2 of 4/);
assert.match(markup, /2 attempted · 1 completed/);
assert.match(markup, /No court request is in flight at this instant/);
assert.match(markup, /separate from court-request timing/);
assert.match(markup, /Activity, line by line/);
assert.match(markup, /Loaded a court calendar resource/);
assert.match(markup, /Completed · 2s/);
assert.match(markup, /Search elapsed/);
console.log('PASS: local OCR, line-by-line source updates, request durations, and search elapsed time render.');
