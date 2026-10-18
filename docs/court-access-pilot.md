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

Each stage must specify source-supported dates (at most seven days), the
calendar scope, a document cap, and a total request budget including the required
calendar document, form submission, scripts/styles, and PDFs. The user's
research goal includes prior court documents that may show an original docket
and future scheduled-hearing documents only when the retrieved PDF already
shows bail information. A qualifying PDF must contain both the docket number and
bail information. Neither a date range nor a scheduled hearing guarantees that
it does. Current incarceration must be known independently; court records do
not prove custody.

The current operator CLI accepts today/future dates only, and the integrated
client stops if the source form's minimum excludes the requested start date.
Do not bypass that minimum. Historical-date support must be established offline
and explicitly scoped before preparing a live stage. For a live attempt, budget
around eight calendar/asset requests plus PDFs; actual overhead must be
measured. This is a planning allowance, not demonstrated overhead or a
guarantee. A cap can stop a stage before it obtains all documents. Neither code
nor a pilot increases caps.

Historical bail entries may be present inside a docket PDF reached from a
current/future calendar result; that is different from searching historical
calendar-event dates. The latter is not supported by the current portal method.
Do not treat one as proof of the other.

Both exact clients must pass: Playwright calendar `route.fetch` and urllib PDF
retrieval. Redirects/retries are disabled. Normal browser assets and PDF requests
share the persisted scheduler and its 60-second response-completion floor. The
current client adds bounded 60–90-second pauses after responses; adaptive
slowdown can require a longer wait. Jitter spreads requests, not automation
identity. The initial ceilings remain 30/hour and 120/day. These are local safety
settings, not official court limits. Stop on denial, 429, challenge, redirect,
timeout, invalid document, uncertain transmission, or sustained deterioration.

The current method is `playwright-calendar+urllib-pdf-v6`. Only the existing
script/style paths can have a single `v` cache-version hash (16–128 URL-safe
characters). Other keys, duplicates, arbitrary assets, and alternate hosts remain
blocked. Required-resource, script-error and native form-submission checks run
before clicking Search. Bounded diagnostic counts/booleans are retained even when
the results parser cannot validate a table; source content and hidden form tokens
are never logged. Earlier-method proofs or permits do not authorize this method.

Dates are blurred before the final form readback. POSTs before the explicit
submission gate are blocked; results require an observed, completed calendar
POST. Missing document links and missing/out-of-window event dates stop
validation, including on duplicate rows. Parsing failures retain bounded reason
codes. The v2 approval prompt was dismissed; neither it nor its prepared record
authorizes a later method. Current protections remain in force.

## Combined Courtroom 506 execution

The bounded October 18–23, 2026 execution uses one `BOUNDED_ENGINE` permit and
one discovery job. The existing worker first binds and reads back Allegheny - 05,
`CP-05-02-Crim`, Bail Hearing, Courtroom 506, and the exact dates. It then proves
the Courtroom 506 public-control/native-submission binding in that same loaded
browser page before it can submit Search. It does not reload the form between
observation and Search.

Every transmitted request from page bootstrap through successful room-binding
observation counts toward both ceilings: no more than three requests before
observation completes and no more than 12 requests total for the whole job.
After observation, the engine has only the actual remainder of those 12 slots;
there is no separately reserved nine-request engine allowance. The same persisted
job counter and request history cover observation, Search, required assets, and
documents. At most five distinct docket documents may be requested. Existing
spacing, one-request concurrency, source barriers, stop conditions and no-retry
rules remain unchanged. A failed observation cannot submit Search. An interrupted
or failed permit is consumed; it cannot resume or replenish its allowance.

The former prerequisite for a *separate, already completed* observation with
matching dates is not necessary: observation now occurs after the exact date
controls have been validated in the same session that will submit Search. The
date window remains exact and mandatory in the permit, form readback, POST-body
check, and returned-result validation. This integrates the observation gate; it
does not remove it or allow evidence from another date window to unlock Search.

After the failed v3 attempt, offline browser tests showed that intentionally
aborted optional images produce console errors too. v4 categorizes an error as
expected optional-resource noise only when its source URL exactly matches an
image/font/media request deliberately aborted by this session, and its text
exactly matches a demonstrated Chromium abort signature. URLs and text remain
ephemeral; category counts are retained. All unclassified console errors,
required-resource failures and page errors still stop the client. This is not
proof of the cause of the failed live run. v4 needs a fresh scoped approval;
the failed v3 permit cannot be reused. The separately approved v4 attempt also
stopped before Search, on a control-state mismatch, and its permit is consumed.

v5 keeps the same transport and validation rules but reports bounded public
control labels and mismatch reasons (missing, wrong form, disabled, unnamed,
value mismatch, submitted count/value mismatch). It never emits actual field
values, HTML or tokens. The separately approved v5 attempt stopped before Search
on `SEARCH_MODE / UNNAMED`; its permit is consumed. No PDF was requested.

v6 distinguishes UI-only selectors from submitted model controls. An unnamed
selector is accepted only when its value matches the intended public filter,
its own known public container contains exactly one enabled, named hidden model
control associated with the same form, that model value also matches, and
FormData contains that model field exactly once with the intended value. It
does not guess a server field name, search elsewhere for a coincidental value,
skip public readback or permit an ambiguous binding. Existing named-control
checks remain. Every public-control failure is retained as a bounded label/reason
in one pass, without values or model-field names. This change has been tested
offline; the actual source backing-field layout is not yet proven. No v6 source
request is approved.

## Operator-only commands

An optional **INSPECT** diagnostic is described in
[`court-form-inspection.md`](court-form-inspection.md). Only its offline
preparation is currently authorized. It is a separate three-GET, zero-PDF,
zero-transmitted-POST scope, never a staged verification result. It preserves
the source pause and requires its own dated, request-capped approval before
running; no failed PDF permit or remaining budget can authorize it.

Build with `pnpm --filter @workspace/api-server run build`. Commands below use
`pnpm --filter @workspace/api-server run pilot <command> ...` (without an extra
`--`, which pnpm forwards to the script). No public approval/run endpoint exists.

- `prepare --stage SINGLE --start YYYY-MM-DD --end YYYY-MM-DD --requests N`:
  store PREPARED scope only; no source requests.
- `prepare-bounded-engine --start YYYY-MM-DD --end YYYY-MM-DD`: prepare the
  combined Courtroom 506 observation and engine permit without traffic. One
  subsequent approval covers the shared 12-request/5-document ceiling.
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
