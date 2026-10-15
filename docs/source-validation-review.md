# Operator review: UJS source-validation barrier

**Prepared:** October 14, 2026  
**Status:** Review prepared October 14; one-use operator gate built October 15. Source traffic remains stopped pending separate run approval.

## Requested search

The user approved exactly one Calendar Event search:

- Allegheny - 05
- Court office `CP-05-02-Crim`
- Courtroom 506
- October 15, 2026 (the user explicitly replaced the now-past October 14 date)
- No event-type filter
- No docket PDFs, second search, retry, or broader collection

The date selection and approval to build the gate are not approval to execute it. The source-wide validation barrier must remain in place.

## Current gate state

A read-only development-database check found:

- `blocked_reason`: `SOURCE_VALIDATION_BARRIER`
- `access_verified_at`: unset
- `verified_method`: unset
- `collection_approved_at`: unset
- `active_request_id`: unset
- Last recorded source request: October 12, 2026

The ordinary calendar-preview API checks this gate before creating a job, and remains blocked. The dedicated operator-only permit described below can authorize only the exact calendar search without clearing the barrier. No source request was sent, and no source-control value was changed while building it. The database observations above are the October 14 read-only snapshot, not a new live-access assessment.

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
2. The user authorized building a dedicated calendar-only path. Obtain separate approval to execute the October 15 scope before preparing, approving, or running its permit.
3. Use that one-use permit only while the source barrier is unchanged. Stop on the first denial, challenge, unexpected response, or validation mismatch; do not retry, fetch PDFs, substitute dates, or infer broader access.

## One-use operator flow

This is an operator CLI action, not a new shared-password web permission. The ordinary preview button remains disabled under the barrier. After separate explicit run approval:

```sh
pnpm --filter @workspace/api-server run pilot prepare-calendar-only
pnpm --filter @workspace/api-server run pilot approve --id <prepared-id> --user-approved
pnpm --filter @workspace/api-server run pilot run --id <prepared-id> --user-approved
pnpm --filter @workspace/api-server run pilot report --id <prepared-id>
```

Preparation sends no source traffic. The fixed scope is Allegheny - 05, `CP-05-02-Crim`, Courtroom 506, October 15, 2026, no event-type filter, zero PDFs, and at most eight total transmitted requests including assets. Only one Search POST is allowed. Existing spacing, rolling limits, cooldown, accounting, and in-flight/uncertain-request protection still apply.

The permit is consumed before the worker starts. The same scope cannot be prepared again, and an attempted job cannot be resumed. An expired date, altered scope, changed source barrier, active job, or missing approval fails closed. A successful calendar result does not set access verification, approve collection, or clear `SOURCE_VALIDATION_BARRIER`; it retains calendar rows only.

## Current disposition

The offline preview and dedicated operator gate are implemented and checked offline. No live search, permit preparation, barrier override, or collection approval was performed. The live search remains unexecuted pending separate approval.
