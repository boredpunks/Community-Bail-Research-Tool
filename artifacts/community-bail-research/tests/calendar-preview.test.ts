import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarPreviewStatus } from '../src/components/calendar-preview-status';

// Abstract status/count inputs only: no docket or case fixtures. The empty-state
// input tests presentation, not the existence of a supported source empty marker.
const base: Parameters<typeof CalendarPreviewStatus>[0]['job'] = {
  status: 'COMPLETED', calendarComplete: true, paginationComplete: true,
  resultCapReached: false, resultsExpiredAt: null,
};
const render = (job = base, count = 0, events: { kind: string; message: string }[] = []) =>
  renderToStaticMarkup(React.createElement(CalendarPreviewStatus, { job, retainedRows: count, events }));

assert.match(render(base, 2), /Calendar results validated/);
assert.match(render(base, 2), /does not establish complete court coverage, PDF access/);
assert.match(render({ ...base, status: 'PAUSED' }, 2), /partial coverage/);
assert.match(render({ ...base, paginationComplete: false }, 2), /partial coverage/);
assert.match(render({ ...base, status: 'RUNNING', calendarComplete: false }), /not a zero-match result/);
assert.match(render(base), /Calendar search not validated/);
assert.doesNotMatch(render(base), /<h4[^>]*>Validated zero matches/);
assert.match(render(base, 0, [{ kind: 'CALENDAR_STATE', message: 'EMPTY_RESULTS_VALIDATED; Search button visible=true.' }]), /<h4[^>]*>Validated zero matches/);
assert.doesNotMatch(render({ ...base, paginationComplete: false }, 0, [
  { kind: 'CALENDAR_STATE', message: 'EMPTY_RESULTS_VALIDATED; Search button visible=true.' },
]), /<h4[^>]*>Validated zero matches/);
assert.match(render({ ...base, status: 'PAUSED', calendarComplete: false }, 0, [{
  kind: 'CALENDAR_FORM_DIAGNOSTIC', message: 'INITIALIZATION: CALENDAR_FORM_INITIALIZATION_TIMEOUT: SEARCH_BUTTON / HIDDEN.',
}]), /SEARCH_BUTTON \/ HIDDEN/);
assert.match(render({ ...base, status: 'PAUSED', calendarComplete: false }, 0, [{
  kind: 'CALENDAR_FORM_DIAGNOSTIC', message: 'INITIALIZATION: CALENDAR_FORM_INITIALIZATION_TIMEOUT: SEARCH_BUTTON / HIDDEN.',
}]), /Search was not ready within 15 seconds/);
assert.match(render({ ...base, status: 'PAUSED', calendarComplete: false }, 0, [{
  kind: 'CALENDAR_FORM_DIAGNOSTIC', message: 'CONTROL_SELECTION: CALENDAR_CONTROL_STATE_MISMATCH: COURT_ROOM / NO_FILTER_NOT_SELECTED.',
}]), /Resolve the exact courtroom or no-filter selection/);
assert.match(render({ ...base, status: 'PAUSED', calendarComplete: false }, 0, [{
  kind: 'PARENT_DIAGNOSTIC_REJECTION', message: 'PARENT_REJECTED_CALENDAR_FORM_DIAGNOSTIC.',
}]), /compatibility locally before another request/);
assert.match(render({ ...base, status: 'PAUSED', calendarComplete: false }), /fresh exact-scope approval/);
assert.match(render({ ...base, resultsExpiredAt: '2026-10-16T00:00:00Z' }), /empty list after expiry is not a zero-match result/);
console.log('PASS: calendar preview success, validated zero, partial, running, failure and expiry states; no case fixtures.');
