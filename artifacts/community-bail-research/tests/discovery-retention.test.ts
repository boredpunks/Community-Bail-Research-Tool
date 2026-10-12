import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpiredResultsNotice, ResumeControl } from '../src/components/discovery-retention';

const items: [] = [];
const job = { status: 'PAUSED', resultsExpiredAt: '2026-10-11T16:00:00.000Z' };
const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
  React.createElement(ExpiredResultsNotice, { resultsExpiredAt: job.resultsExpiredAt, items }),
  React.createElement(ResumeControl, {
    job,
    pending: false,
    collectionEnabled: true,
    onResume: () => {},
  }),
));

assert.match(markup, /Unsaved results expired after 24 hours/);
assert.match(markup, /No unsaved result rows remain/);
assert.match(markup, /saved candidates remain available/);
assert.match(markup, /cannot resume or replay collection/);
assert.match(markup, /this empty list does not indicate that the calendar had no matching dockets/);
assert.match(markup, /data-testid="empty-items"/);
assert.doesNotMatch(markup, /data-testid="button-resume"/);
assert.doesNotMatch(markup, />Resume</);
console.log('PASS: expired empty search explains retention and omits Resume.');
