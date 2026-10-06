# Court-access pilot protocol

This implementation is not authorization to contact the court. The prior
single-request standard-HTTP approval has already been used and cannot be reused.
The prior integrated-client denial remains unresolved until a newly approved
exact-client assessment passes. Empty request history is not proof of access.

## Separate stages and decisions

1. **SINGLE:** one real calendar-linked, identity-checked PDF.
2. **SMALL:** three such PDFs, only after SINGLE passes and a new approval.
3. **MODEST:** ten PDFs, after SMALL passes, at least one hour later, with another
   approval. This stage exceeds the current five-document protected cap.

Each stage must specify supported today/future dates (at most seven days), the
calendar scope, a document cap, and a total request budget including the required
calendar document, form submission, scripts and styles. Budget around eight
calendar/asset requests, plus PDFs; actual overhead must be measured. This is a
planning allowance, not demonstrated overhead or a guarantee. A cap can stop a
stage before it obtains all documents. Neither code nor a pilot increases caps.

Both exact clients must pass: Playwright calendar `route.fetch` and urllib PDF
retrieval. Redirects/retries are disabled. Normal browser assets and PDF requests
share the persisted scheduler, 60-second response-completion pace, initial
30/hour and 120/day ceilings, and adaptive slowdown. These are local safety
settings, not official court limits. Stop on denial, 429, challenge, redirect,
timeout, invalid document, uncertain transmission, or sustained deterioration.

## Operator-only commands

Build with `pnpm --filter @workspace/api-server run build`. Commands below use
`pnpm --filter @workspace/api-server run pilot -- ...`. No public approval/run
endpoint exists.

- `prepare --stage SINGLE --start YYYY-MM-DD --end YYYY-MM-DD --requests N`:
  store PREPARED scope only; no source requests.
- `approve --id UUID --user-approved`: only **after separate user approval** for
  that precise stage and scope. Permit expires after 24 hours. Current protected
  caps are checked; exceeding them requires separate operator-budget approval.
- `run --id UUID --user-approved`: only after that approval, with the managed API
  worker stopped. The runner must acquire the same worker lease. It atomically
  consumes the permit before sending any request. Restart the managed API
  workflow when the runner exits. ATTEMPTED/FAILED permits cannot be reused.
- `report --id UUID`: reads persisted status and accounting only.
- `approve-collection --id UUID --user-approved`: an additional explicit decision
  after a fresh verified MODEST report. Does not start a search or raise any cap.

Do not run the legacy one-request assessment command. Its old numeric permit is
rejected by the scheduler. Changing a client invalidates current-method proof.
No automatic client switching, IP rotation, CAPTCHA workaround, date expansion,
budget expansion, retry, or cooldown-driven job restart is allowed.

## Evidence required to pass

Validated calendar results; the requested number of identity-checked readable
documents with demonstrated extraction or explicit missing-section outcomes;
all transmitted assets accounted for; every response successful; no overlap;
at least the configured pause after each response; no latency warning; clean
completion; and no post-stop transmission. Incomplete/empty calendar results,
unmet stage targets, unsupported layouts and request exhaustion fail the stage.
Raw PDF/HTML/cookies are not persisted or logged. Results remain provisional;
posted/custody and operative-order claims are not inferred.

A VERIFIED pilot records method-specific proof but leaves broader collection
unapproved. Small staged samples do not establish reliability for 100 requests.
Only after all stages and explicit collection approval should a separate
100-distinct-match proposal specify dates, monetary TOTAL_BAIL **≤ $5,000**,
processing/request/rolling budgets, expected elapsed time, shortfall risks,
pagination limitations, and stop/resume rules. The 100-match sample remains
unstarted until the user approves that exact scope.

## Offline verification

`pnpm --filter @workspace/api-server run test:safety` uses a disposable empty
PostgreSQL schema and a controllable clock. It checks real concurrent
reservations, unique in-flight ownership, response-completion pacing, stops,
rolling limits, crash accounting, permit gates, expiry, HTTP classification,
and inclusive numerical comparisons. It never creates docket/case records or
contacts the court. The schema is dropped when checks finish.
