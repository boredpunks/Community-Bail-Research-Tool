import React from 'react';

type PreviewStatus = {
  status: string;
  calendarComplete: boolean;
  paginationComplete: boolean;
  resultCapReached: boolean;
  resultsExpiredAt: string | null;
};

type PublicEvent = { kind: string; message: string };

function failureAction(event: PublicEvent) {
  if (event.kind === 'PARENT_DIAGNOSTIC_REJECTION')
    return 'Repair the worker/app status-message compatibility locally before another request. This rejection does not establish a court-form defect.';
  if (event.message.includes('COURT_ROOM'))
    return 'The source did not establish the approved courtroom scope. No Search was sent. Resolve the exact courtroom or no-filter selection before fresh approval; do not silently keep or reset a selected room.';
  if (event.message.includes('CALENDAR_FORM_INITIALIZATION_TIMEOUT'))
    return 'Search was not ready within 15 seconds. No Search was sent. Correct the public button’s initialization, visibility or form association before another approved attempt.';
  if (event.message.includes('OUTSIDE_SOURCE_RANGE'))
    return 'The requested dates fall outside the source’s public limits. No Search was sent. Any changed date window needs explicit approval; dates were not adjusted automatically.';
  if (event.message.includes('OPTION_MISSING') || event.message.includes('OPTION_DISABLED'))
    return 'The requested public option was unavailable. No Search was sent. Confirm the exact office/event criteria before another approval; no substitute option was selected.';
  if (event.message.includes('BACKING_') || event.message.includes('SUBMITTED_') || event.message.includes('VALUE_MISMATCH'))
    return 'The selected criteria did not agree with their native submitted values. No Search was sent. Repair the local selection/readback binding before another approval.';
  return 'No Search was sent from this failed preflight. Resolve the identified control’s uniqueness, form association, enabled state or form bounds locally before fresh approval.';
}

export function CalendarPreviewStatus({ job, retainedRows, events }: {
  job: PreviewStatus;
  retainedRows: number;
  events: PublicEvent[];
}) {
  const active = job.status === 'QUEUED' || job.status === 'RUNNING';
  const emptyValidated = job.calendarComplete && job.paginationComplete && !job.resultCapReached && events.some(event =>
    event.kind === 'CALENDAR_STATE' && event.message.startsWith('EMPTY_RESULTS_VALIDATED;'));
  const partial = job.status !== 'COMPLETED' || !job.paginationComplete || job.resultCapReached;
  const diagnostic = events.find(event =>
    event.kind === 'CALENDAR_FORM_DIAGNOSTIC' || event.kind === 'PARENT_DIAGNOSTIC_REJECTION');
  let title: string;
  let detail: string;
  if (job.resultsExpiredAt) {
    title = 'Preview results expired';
    detail = 'The retained row list is no longer available. An empty list after expiry is not a zero-match result; the attempt history remains available.';
  } else if (active) {
    title = 'Calendar preview running';
    detail = retainedRows > 0
      ? 'Validated rows are available below while the bounded attempt finishes.'
      : 'No validated rows are available yet. This is not a zero-match result.';
  } else if (job.calendarComplete && retainedRows > 0) {
    title = partial ? 'Validated calendar rows — partial coverage' : 'Calendar results validated';
    detail = partial
      ? 'Authorized rows already validated are retained below. The stopped attempt or incomplete pagination limits coverage; no second search will start automatically.'
      : 'The returned calendar rows were validated. This does not establish complete court coverage, PDF access, bail information, custody or collection approval.';
  } else if (emptyValidated) {
    title = 'Validated zero matches';
    detail = 'The source-backed empty-result condition was validated for the exact submitted criteria. This says nothing about other dates, courtrooms or events.';
  } else {
    title = 'Calendar search not validated';
    detail = 'The attempt did not establish results or zero matches. Review the failure detail and event log. An operator must resolve the specific issue and obtain fresh exact-scope approval before another attempt; this preview cannot be resumed.';
  }
  return (
    <div className="border border-border rounded p-3 mb-4" role="status" data-testid="calendar-preview-outcome">
      <h4 className="mono font-bold">{title}</h4>
      <p className="hint mt-1">{detail}</p>
      {!active && !job.calendarComplete && diagnostic ? (
        <div className="hint mt-2" data-testid="calendar-preview-failure-detail">
          <p>{failureAction(diagnostic)}</p>
          <p className="mt-1">First retained form/protocol failure: {diagnostic.message}</p>
        </div>
      ) : null}
    </div>
  );
}
