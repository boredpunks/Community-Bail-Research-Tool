import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GetResearchOperations200 } from '@workspace/api-client-react';
import { SourceReadiness } from '../src/components/source-readiness';

const render = (operations: GetResearchOperations200) => renderToStaticMarkup(
  React.createElement(SourceReadiness, { operations }),
);
const base: GetResearchOperations200 = {
  calendarEnabled: true,
  calendarBlockedReason: null,
  documentEnabled: false,
  documentBlockedReason: 'ACCESS_DENIED',
  pacing: {},
  notice: 'Separate readiness states.',
};

const calendarAvailable = render(base);
assert.match(calendarAvailable, /Calendar search:<\/strong> Available for admission checks/);
assert.match(calendarAvailable, /Documents\/PDF retrieval:<\/strong> Blocked: ACCESS_DENIED/);
assert.doesNotMatch(calendarAvailable, /Calendar search:<\/strong> Blocked/);

const documentAvailable = render({
  ...base,
  calendarEnabled: false,
  calendarBlockedReason: 'REQUEST_IN_FLIGHT',
  documentEnabled: true,
  documentBlockedReason: null,
});
assert.match(documentAvailable, /Calendar search:<\/strong> Blocked: REQUEST_IN_FLIGHT/);
assert.match(documentAvailable, /Documents\/PDF retrieval:<\/strong> No current document blocker/);
assert.doesNotMatch(documentAvailable, /Documents\/PDF retrieval:<\/strong> Blocked/);
console.log('PASS: calendar admission and document blockers render independently.');
