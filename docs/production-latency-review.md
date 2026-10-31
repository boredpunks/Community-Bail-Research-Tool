# Production latency warning: operator review and recovery

The project state reports a calendar response of about 52.2 seconds and a
persisted source validation barrier. This document describes a safe review; it
does not claim that production state was queried or changed during this task.

## Review the retained evidence first

Use read-only inspection of the existing source state, request ledger, job, and
events. Preserve the original rows and timestamps. Record the request and job
identifiers, response outcome/status, measured duration, relevant calendar
diagnostics, and the exact barrier and warning values. Do not infer that the
barrier was caused only by invalid calendar rows: a real slow response remains
a separate source-health signal.

Classify the 52.2-second observation using that retained evidence. A later fast
response does not erase the warning. Response accounting must not clear it
automatically. This procedure does not reset the warning; a future warning
reset requires its own reviewed and explicitly authorized procedure. Keep
conservative pacing, and do not retry the slow request or silently substitute
its criteria.

## Conditions for clearing the historical barrier

`pilot clear-barrier` is an operator-only state change. Run it only after the
operator has reviewed the retained evidence, recorded a concrete reason that
supports clearing this specific validation barrier, and explicitly approved
that operation. It requires `--reason` and `--user-approved`; it is not a
source request and does not itself authorize one.

The command must refuse to clear unless all of these conditions hold:

- The source still has exactly `SOURCE_VALIDATION_BARRIER`.
- There is no active source request and no `IN_FLIGHT` request in the ledger.
- Any source pause has expired.
- A retained request and its job exist to anchor the audit event.

The barrier change and audit event are written together. The event records the
timestamp, prior barrier, operator, and exact reason. Only `blockedReason` is
cleared. The latency warning, pause timestamp, access proof, collection
approval, permits, request/job history, and consumed budgets are not reset.
Never clear or overwrite those fields manually to make a run pass.

Clearing this barrier is not a retry, an access verification, or permission for
future traffic. Any later source operation still requires its own explicit
per-run authorization and must pass the current request gates. A retained
latency warning continues to block the first-document access check and
operator assessment paths that require a clean source-health state. No
automatic retry or warning reset is enabled; clearing the source barrier is
available only through the explicit operator command above.

## Scope of this review

No production source request, permit, barrier clear, latency-warning reset, or
other production state change is authorized by this document. Do not run the
worker or `pilot clear-barrier` as part of an offline code review. Preserve
existing evidence and audit history for the authorized operator decision.
