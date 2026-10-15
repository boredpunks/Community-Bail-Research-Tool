# Operator review: UJS source-validation barrier

**Prepared:** October 14, 2026  
**Status:** Review prepared; source traffic remains stopped.

## Requested search

The user approved exactly one Calendar Event search:

- Allegheny - 05
- Court office `CP-05-02-Crim`
- Courtroom 506
- October 14, 2026
- No event-type filter
- No docket PDFs, second search, retry, or broader collection

That approval does not override the existing source-wide validation barrier.

## Current gate state

A read-only development-database check found:

- `blocked_reason`: `SOURCE_VALIDATION_BARRIER`
- `access_verified_at`: unset
- `verified_method`: unset
- `collection_approved_at`: unset
- `active_request_id`: unset
- Last recorded source request: October 12, 2026

The calendar-preview API checks this gate before creating a job, and the shared request scheduler checks it again before reserving any source transmission. The approved search therefore cannot proceed under the current state. No source request was sent, and no source-control value was changed.

## Existing evidence and limits

- Only `CourtOffice=CP-05-02-Crim` was directly confirmed in the previously captured request body.
- The actual served values and form bindings for the selected district, room, search mode, and no-filter choice have not been verified.
- The live POST target, method, encoding, and session or anti-forgery behavior remain unverified. The offline fixture is not source evidence.
- The current development request ledger contains 14 successful `GET /CaseSearch` requests and 14 successful requests each for the known script and stylesheet. It contains no recorded `/CaseSearch` POST or docket-PDF request. This ledger does not replace the previously documented integrated-client denial; a missing older ledger row is not proof that it did not occur.
- Stored assessments include one inspected `COVERAGE` run, 11 inspected `FILING_INSPECT` runs, and two failed `FILING_INSPECT` runs. The inspected runs were limited to three GETs each; their reports explicitly say they did not submit Search or retrieve PDFs and did not change the source pause or access proof.
- The two stored `CALENDAR_STATE` messages say `SUBMISSION_NOT_OBSERVED`. There are no stored calendar form-diagnostic entries. These summaries do not establish why the source-wide barrier was set.
- The source row has no reason-history field, and the current records do not establish who set `SOURCE_VALIDATION_BARRIER` or what event originally triggered it. Do not infer a cause or clear it from this review.
- The existing offline preview and tests confirm that the implementation fails closed on missing or ambiguous controls, checks the exact date and request shape, and cannot fetch PDFs or resume. They do not prove live court access.
- The ordinary document-processing pilot is not an acceptable substitute for the approved calendar-only search because it can retrieve docket documents.

## Recommended operator decision

1. Keep `SOURCE_VALIDATION_BARRIER` in place until an operator reviews its underlying validation history. Do not clear it with a direct database edit, infer access from a prior client, or reuse the one-search approval as a general collection grant.
2. Decide whether a dedicated, operator-approved calendar-only verification path is needed to establish the current browser client's behavior without PDF retrieval or broader collection.
3. If that review authorizes a specific source operation and the gate is properly resolved, confirm that the operation still matches the user's exact one-search scope. Stop on the first denial, challenge, unexpected response, or validation mismatch; do not retry or fetch PDFs.

## Current disposition

The offline preview is implemented and verified. The approved live search remains blocked. No source request, barrier override, or collection approval was performed.
