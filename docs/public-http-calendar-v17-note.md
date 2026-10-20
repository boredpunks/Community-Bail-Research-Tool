# Conditional v17 calendar — one-page design note, not implementation

Status: written only. No probe rerun, HTTP calendar implementation, fallback,
retry, approval or source request.

If a future approved SINGLE's Playwright calendar fails to validate, stop that
run. Do not retry it with plain HTTP. A plain-HTTP calendar would be a separate,
new-method v17 proposal with separate owner review and proof; v16 proof must
not carry over.

Proposed narrow design: a cookie jar scoped to the calendar GET/POST only,
source-provided form anti-forgery token and current public controls, the same
field construction as the owner's supplied plain_http_probe2.py, existing
calendar structure/parser validators, exact captured report actions kept
byte-for-byte. No constructed report URLs. A separate fresh document opener
has no cookies, Referer or Authorization. Keep the exact identification
User-Agent, no redirects, zero retries, persisted grants before every actual
transmission, shared quotas, sequential operation, existing PDF size/signature/
identity/extraction checks and source stops. Do not copy browser cookies or
replay captured opaque values from old jobs.

New validation required before proposing a live run:

1. Source-control allowlist and precise form schema: action/method, current
   public office/event/room backing inputs, selected filters, fresh Eastern
   dates, source anti-forgery token handling, and required dependencies.
2. Offline routed GET/POST fixtures validating token/form-field construction
   and exact submitted criteria, including changed/missing/duplicate fields.
3. Genuine current result-table layout, bounded complete response handling,
   identity-matching action capture, duplicate/event grouping, 500-row cap,
   explicit empty-status proof, pagination/coverage disclosure and no guessed
   empty-result success.
4. Refusal/challenge/redirect/timeout/size/encoding cases: one accounted
   transmission per grant, safe evidence, no alternate-client recovery.
5. All opaque action encodings preserved, precise capture timestamp and
   independent document GET elapsed time, one-use owner approval/audit and
   stop-clear semantics.
6. Separate method invalidation/proof, request-count forecast for actual GET,
   POST and required dependencies; compatibility with pilot timing predicates.
7. Only after offline review: an owner-approved development-only fresh scope,
   independent owner portal comparison, and exact ledger reconciliation.

The owner's probe establishes feasibility for that client's run, not the
app's future v17 client. This note provides no permission or live evidence.
