import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentTimingDetails } from '../src/components/DocumentTimingDetails';

const markup = renderToStaticMarkup(createElement(DocumentTimingDetails, {
  timings: {
    slot_wait_ms: 12,
    retrieval_ms: null,
    extraction_ms: 90,
    persistence_ms: 0,
  },
}));
for (const stage of [
  'slot wait 12 ms',
  'request/response Not recorded',
  'local extraction 90 ms',
  'evidence save 0 ms',
]) {
  assert.ok(markup.includes(stage), `Search result details should display ${stage}.`);
}
assert.equal(renderToStaticMarkup(createElement(DocumentTimingDetails, { timings: undefined })), '',
  'Results without timing metadata should not show fabricated durations.');
assert.equal(renderToStaticMarkup(createElement(DocumentTimingDetails, {
  timings: { slot_wait_ms: null, retrieval_ms: null, extraction_ms: null, persistence_ms: null },
})), '', 'All-null legacy timing metadata should remain hidden.');
console.log('PASS: independent PDF timing values render correctly and missing legacy timings stay absent.');
