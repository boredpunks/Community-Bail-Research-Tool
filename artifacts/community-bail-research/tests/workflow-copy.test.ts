import assert from 'node:assert/strict';
import {
  CANDIDATE_SAVED_LABEL,
  CANDIDATE_SAVE_LABEL,
  CANDIDATE_SAVE_TITLE,
  CANDIDATES_ACTIVE_DESCRIPTION,
  CANDIDATES_ARCHIVE_DESCRIPTION,
  REVIEW_DESCRIPTION,
  REVIEW_TITLE,
  WORKFLOW_NAV,
  WORKFLOW_PANELS,
} from '../src/lib/workflow-copy';

const screens = ['Search', 'Review', 'Candidates'];
assert.deepEqual(WORKFLOW_PANELS.map(({ title }) => title), screens);
assert.deepEqual(WORKFLOW_NAV.map(({ label }) => label), screens);
assert.deepEqual(WORKFLOW_PANELS.map(({ href }) => href), ['/search', '/review', '/candidates']);
assert.deepEqual(WORKFLOW_NAV.map(({ href }) => href), ['/search', '/review', '/candidates']);

const reviewPanel = WORKFLOW_PANELS.find(({ href }) => href === '/review');
assert.equal(reviewPanel?.title, 'Review');
assert.match(reviewPanel?.text ?? '', /matches from all searches/i);
assert.equal(REVIEW_TITLE, 'Shared review queue');
assert.match(REVIEW_DESCRIPTION, /until any workspace user deletes/i);
assert.match(REVIEW_DESCRIPTION, /not human confirmation/i);
assert.match(REVIEW_DESCRIPTION, /shared Candidates/i);

const candidatePanel = WORKFLOW_PANELS.find(({ href }) => href === '/candidates');
assert.match(candidatePanel?.text ?? '', /explicitly saved to the shared Candidates list/i);
assert.match(candidatePanel?.text ?? '', /does not verify or approve/i);
assert.match(CANDIDATES_ACTIVE_DESCRIPTION, /records list membership/i);
assert.match(CANDIDATES_ARCHIVE_DESCRIPTION, /does not verify or approve/i);
assert.equal(CANDIDATE_SAVE_LABEL, 'Save to Candidates');
assert.equal(CANDIDATE_SAVED_LABEL, 'In shared Candidates');
assert.match(CANDIDATE_SAVE_TITLE, /does not verify or approve/i);
assert.doesNotMatch(candidatePanel?.text ?? '', /reviewed and approved/i);

console.log('PASS: Search, Review, and Candidates labels, routes, and state descriptions stay aligned.');
