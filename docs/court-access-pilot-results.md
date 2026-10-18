# Court-access pilot evidence

## One-PDF stage — October 6, 2026

**Outcome: FAILED. Court access is not verified. The staged task remains incomplete.**

### Authorization and fixed scope

- The user delegated parameter selection and then separately approved only this one-PDF stage.
- Calendar scope: CP-05-02-Crim, Bail Hearing, October 6–12, 2026 inclusive.
- Maximum PDFs: 1. Maximum total requests: 9, including calendar documents, form submission, assets, and PDFs.
- Prepared pilot: `491ec71c-ff20-46a8-9ad8-c05fafcf1a8b`.
- Associated job: `8adc78d1-f847-4222-83f8-8fe132acb839`.
- Method: `playwright-calendar+urllib-pdf-v1`. The PDF client was **not reached**.
- Approval recorded: `2026-10-06T08:37:48.403Z`.
- Pilot started: `2026-10-06T08:38:01.832Z`.
- Pilot finished: `2026-10-06T08:39:09.828Z`.
- The user's suggestion of 30–90-second intervals was not implemented. The protected response-completion minimum remained 60 seconds, with the existing adaptive slowdown.
- Protected caps remained five documents and twelve requests. No operator limits were raised.

### Persisted request ledger

All times below are UTC. No raw HTML, PDF, cookies, or credentials are included.

| Method and path | HTTP status / outcome | Started | Response completed | Duration | Gap after prior response |
| --- | --- | --- | --- | --- | --- |
| GET `/CaseSearch` | 200 / OK | 08:38:06.938 | 08:38:07.697 | 759 ms | — |
| POST `/CaseSearch` | 200 / OK | 08:39:07.704 | 08:39:08.304 | 600 ms | 60,007 ms |

The ledger contains exactly two transmitted requests, no separately transmitted asset requests, and no PDF requests. The measured gap exceeded the configured minimum. Successful transport does **not** establish that the submitted search produced valid calendar results or that required browser assets were available.

### Validation barrier and retained stop

The persisted event was:

> Source barrier: RETURNED_FORM: no validated calendar results table. Not an empty search. Completed results retained.

- The job was paused at `2026-10-06T08:39:09.523Z` with `calendar_complete = false`.
- The source-wide block is `SOURCE_VALIDATION_BARRIER`.
- The final pilot report has 2 requests, 0 transport failures, and 0 valid documents.
- No access-verification method or timestamp was established; collection approval remains unset.
- The source has no active request, no latency warning, and retains 60,000 ms adaptive spacing.
- A read-only ledger check after the runner exited and the API restarted found **zero requests after the job stop** and **zero requests after the pilot completion**.
- The failed permit is consumed and cannot be reused. There was no automatic retry, client switch, budget increase, date expansion, or advancement to later stages.

The returned form is not evidence of an empty result set. The cause of the missing validated results is not established. Offline inspection confirmed that the old request allowlist rejected query strings on the two known script/style paths. This is a plausible regression, not proof that a versioned asset was actually blocked in this run: blocked-request counts and attempted asset URLs were not captured. No network cause can be inferred.

### Failed-run audit: retained and missing evidence

| Evidence | Finding |
| --- | --- |
| Browser action trace | **Not captured.** Source code shows the intended actions; it is not a replayable record of what the court page rendered. |
| Before/after screenshots or DOM snapshots | **Not captured.** The response body was consumed transiently by the parser and was not retained. |
| Request ledger | Two `/CaseSearch` requests, methods, HTTP status, start/completion time, duration, and the 60,007 ms inter-response gap are retained above. No other request or retry was recorded. |
| Blocked requests | **Not captured** by the persisted request ledger. The old browser worker had an in-memory block count but did not persist it before its parser barrier. |
| Response content type / redirect chain | **Not captured.** Each HTTP response was a single request with redirects disabled; no chain was followed. Content-type headers were not persisted. |
| Intended court/event/date inputs | The job scope and selectors/actions in source are known. **The failed run did not record the selected option labels/values or actual POST field values**, so they cannot be independently confirmed from its evidence. |
| Form validation / page errors | The old client checked native form validity in code. **The evaluated field values, page errors, and browser console trace were not captured.** |
| Session values | No cookie or hidden token values were retained or inspected. |

The last verified transport step was the HTTP 200 initial page response, followed by the HTTP 200 calendar POST response. The first unverified step is whether that POST produced a correctly scoped, validated result table: the retained parser outcome says it did not find one, but contains no page artifact to examine. The configured public entry point is `/CaseSearch`; a previous normal-browser assessment is recorded in `docs/ujs-source-access-assessment.md`. That prior method and result do not prove current-client field state or access.

### Historical offline follow-up before the v3 attempt

The client-method version is now `playwright-calendar+urllib-pdf-v3`. Offline changes narrowly admit a bounded `v` hash only on the two already-known JavaScript/CSS paths, check that assets completed, and verify selected public filter values and submitted form data in memory before Search. Unknown hosts, paths, query keys, and redirects remain disallowed. Counts and fixed state labels—including page-error and console-error counts, never their text—are recorded along with an explicit `FORM_READY` state before submission. Dates are blurred before readback, early POSTs are blocked, and results require an observed completed POST. All data rows need document links and in-window event dates, including duplicate rows. Prior-method approvals do not authorize this version.

The regression checks use explicitly labeled synthetic **public form/layout markup only**, with no docket rows or case records. A header-only table/form combination is deliberately classified `RESULTS_NOT_VALIDATED`, not successful or empty. No exact source empty-state marker was captured, so the live client does not claim `EMPTY_RESULTS_VALIDATED`. Duplicate-row behavior remains covered by the source parser's first-seen deduplication code but cannot be exercised with a positive docket fixture without inventing docket data; no matching raw source artifact was retained. A saved source-backed fixture would be needed for that test.

## Historical v2 preparation and subsequent v3 scope

- Stage: SINGLE, one calendar-discovered identity-checked PDF; current method `playwright-calendar+urllib-pdf-v3`.
- Earlier v2 prepared record: `05506502-436e-48dc-a0b0-58374111a444`, state `PREPARED`; its approval prompt was dismissed. It is stale for v3 and cannot be used.
- Fixed scope: CP-05-02-Crim / Bail Hearing, October 6–12, 2026. The live page must confirm dates and controls; otherwise stop before Search.
- Total request cap: 9, including the form, all browser assets, and PDF. Plan inventory is 7 requests (initial page + known script/style, one form submission + known script/style, one PDF), with at most 2 requests of headroom. Every additional asset remains counted. If the nine-request ceiling prevents completion, stop; do not increase it.
- Pacing: 60–90 seconds after each response completes, never below the protected 60-second floor; the shared scheduler can require longer. This spreads request timing but does not avoid detection or establish source permission.
- Expected duration: roughly 8–12 minutes at the planned 7 requests, up to about 15 minutes if the full 9-request ceiling is used, plus any longer adaptive waits. This is an estimate, not a service guarantee.
- Stop on denial, throttle/challenge, redirect, missing/blocked required asset, form/control mismatch, invalid or unvalidated results, timeout, uncertain transmission, latency warning, or request exhaustion. No retry, client/proxy change, date expansion, or budget expansion.
- The SINGLE v1 permit is consumed. The v2 prompt was dismissed. The user's later instruction, “I hope to see a successful pdf retrieval and docket information when I return. Proceed until victory,” is being applied only to a newly prepared one-PDF v3 stage under the unchanged dates and nine-request ceiling. It does not approve retries, the three-PDF stage, ten-PDF stage, collection, or a 100-match sample. Any barrier stops the attempt.

The v2 offline check passed 101 safety checks and 12 Python tests. The later v3 offline checks passed 101 safety checks and 14 Python protocol/browser tests, including blur-triggered date changes, replaced dependent controls, malformed missing links and bounded event dates. TypeScript typecheck, API build and Python compilation passed. No docket fixtures or court traffic were used by these tests.

## One-PDF v3 attempt — October 6, 2026

**Outcome: FAILED before Search submission. No PDF retrieved; no docket information created. The full staged task remains incomplete.**

- Current-method pilot: `ebf1fa38-dda9-4351-8287-a4eeaf12173b`.
- Associated job: `ee1bc19c-800a-4d1c-ba17-418004ac6e74`.
- Fresh authorization: the user's later explicit request to proceed with PDF retrieval, applied only to the previously presented one-PDF scope and nine-request cap. No approval for unlimited retries or later stages was inferred.
- Method: `playwright-calendar+urllib-pdf-v3`; urllib was not reached.
- Fixed scope: CP-05-02-Crim, Bail Hearing, October 6–12 inclusive; one PDF, nine total requests, protected caps unchanged.
- Permit consumed; completion recorded at `2026-10-06T09:12:14.147Z`.

| Method/path | Status/outcome | Started (UTC) | Completed (UTC) | Duration | Gap after prior response |
| --- | --- | --- | --- | --- | --- |
| GET `/CaseSearch` | 200 / OK | 09:09:48.708 | 09:09:49.839 | 1,131 ms | — |
| GET `/resource/css/sitemain.min.css` | 200 / OK | 09:10:54.831 | 09:10:55.065 | 234 ms | 64,992 ms |
| GET `/resource/js/sitemain.min.js` | 200 / OK | 09:12:07.329 | 09:12:07.597 | 268 ms | 72,264 ms |

The persisted READY diagnostic reports both known assets loaded, zero blocked
scripts/stylesheets/document-data requests, zero page errors, and **two console
errors**. The preflight's `CALENDAR_SCRIPT_ERROR` code currently covers console
errors as well as page errors; it does not establish that JavaScript execution
failed. The next state was `SUBMISSION_NOT_OBSERVED`. No POST, validated result
table, candidate or PDF exists for this attempt.

Console text, console source locations, optional image/font blocked-request
details, DOM and screenshots were not captured. The two errors might relate to
blocked optional resources or another page issue; their actual cause is
unresolved. Do not claim that the repaired form was submitted, that dates were
supported by final readback, that the court denied this attempt, or that the
calendar was empty.

The worker stopped after 3 of 9 requests; the remaining budget is not permission
to reuse its consumed permit. There was no overlap, each gap exceeded 60 seconds,
and the read-only post-completion ledger check found zero further requests.
The API was restarted; `SOURCE_VALIDATION_BARRIER` remains set, access proof and
collection approval remain unset, and no request is active.

Before another attempt, use offline browser fixtures to distinguish console
errors caused by intentionally blocked optional resources from actual required
resource/runtime failures, and design bounded diagnostic categories without
retaining raw source content or tokens. Do not silently ignore console errors
or retry the live source to infer their cause. Any further court attempt needs
a new exact-scope, current-method approval.

## Offline v4 repair after the stopped attempt

A network-blocked browser fixture reproduced two console errors from two
deliberately aborted optional images, without any source request. This proves
that the earlier generic console-error barrier can reject a working page due to
our own optional-resource policy. It does **not** prove that those were the two
errors in the live v3 run, whose source locations and text were not captured.

The current method is `playwright-calendar+urllib-pdf-v4`. It separates only exact
Chromium abort messages tied to image/font/media URLs deliberately aborted by
the same browser session. Raw error text and URLs remain in memory only.
Proven optional-abort counts and unclassified error counts are retained
separately. Unclassified console errors, page errors, blocked required resources,
and all transport/identity/validation barriers still stop the client.

Offline verification passed 101 safety checks and 15 Python tests, including
the actual browser optional-abort reproduction and rejection of unrelated error
messages/URLs. Typecheck, build and Python compilation passed. No additional
court request was made to validate this repair.

New offline prepared scope: `19c9d215-d384-4199-9eeb-f9dcb0f15ba4`, method v4,
state `PREPARED`, CP-05-02-Crim / Bail Hearing, October 6–12, one PDF, nine total
requests including assets. The same 7-request inventory plus 2-request headroom,
60–90-second response-completion pauses and roughly 8–15-minute estimate apply.
This entry was subsequently separately approved by the user and executed once,
as documented below. It is now consumed and failed. There are no automatic
retries or later-stage approvals.

## Separately approved one-PDF v4 attempt — October 6, 2026

**Outcome: FAILED before Search submission, at the final form readback. No PDF
was requested or retrieved. The staged verification task remains incomplete.**

- Pilot: `19c9d215-d384-4199-9eeb-f9dcb0f15ba4`.
- Job: `6565baca-0da4-49b5-90ea-c4acc70a2cac`.
- User explicitly selected “Approve one new one-PDF attempt.”
- Fixed scope: CP-05-02-Crim / Bail Hearing, October 6–12 inclusive; one PDF,
  nine additional total requests including assets. Protected limits unchanged.
- Approved: `2026-10-06T09:22:39.689Z`.
- Started: `2026-10-06T09:22:45.701Z`.
- Completed: `2026-10-06T09:25:30.244Z`.

| Method/path | Status/outcome | Started (UTC) | Completed (UTC) | Duration | Gap after prior response |
| --- | --- | --- | --- | --- | --- |
| GET `/CaseSearch` | 200 / OK | 09:23:00.657 | 09:23:01.498 | 841 ms | — |
| GET `/resource/css/sitemain.min.css` | 200 / OK | 09:24:08.059 | 09:24:08.350 | 291 ms | 66,561 ms |
| GET `/resource/js/sitemain.min.js` | 200 / OK | 09:25:28.164 | 09:25:28.394 | 230 ms | 79,814 ms |

The READY diagnostic confirmed both required bundles loaded, zero blocked
scripts/stylesheets/document-data requests, zero page errors, zero unclassified
console errors and two proven optional-abort errors. This establishes the
optional-error distinction for this run, not retrospectively for v3.

The barrier was `CALENDAR_CONTROL_STATE_MISMATCH`, followed by
`SUBMISSION_NOT_OBSERVED`. The final in-memory check rejected at least one
control because it was missing, belonged to another form, was disabled/unnamed,
or did not retain the expected value. The failed run did **not** retain which
control or condition failed. Its cause cannot be narrowed further from the
saved evidence; do not claim the source changed, the dates were accepted, or
that a correct Search POST occurred.

No POST, candidate, result table or PDF was recorded. All three responses were
successful and under 20 seconds; both gaps exceeded 60 seconds and there was
no overlap. A read-only check found zero requests after completion.
The permit is consumed; unused budget is not a retry authorization. The API was
restarted, source-wide `SOURCE_VALIDATION_BARRIER` remains set, access proof and
collection approval remain unset, and no request is active.

### Offline diagnostic extension after v4

The current method is `playwright-calendar+urllib-pdf-v5`. It preserves every
existing transport and validation rule while returning a fixed public control
label and reason for each control/submitted-data mismatch. These labels do not
contain actual form values, names of parties, hidden fields, HTML, token values
or console text. Browser mutation tests verify that disabled, unnamed and
duplicated public controls produce the correct safe metadata; the parent rejects
unknown labels/reasons and inconsistent code/reason pairs.

No v5 court request has been approved or sent. Its new metadata cannot
reconstruct the earlier failed page. A future exact-scope attempt needs fresh
approval, or a separately acquired sanitized source-backed form artifact can be
examined offline first. Do not weaken the checks or start the three-PDF stage
without successful first-stage proof.

The extension passed 106 offline safety checks and 15 Python browser/protocol
tests, TypeScript typecheck, API build, Python compilation and whitespace checks.
No synthetic docket/case records or court requests were used by these checks.

### v5 preparation — October 6, 2026

After the user's “Proceed,” a new scope was prepared for a separately approved
diagnostic-enhanced one-PDF attempt:

- Pilot: `0e1010e6-5da4-4168-9ffe-fc18ce802467`, state `PREPARED`.
- Method: `playwright-calendar+urllib-pdf-v5`.
- Scope: CP-05-02-Crim / Bail Hearing, October 6–12 inclusive.
- Maximum one PDF and nine total additional requests, including calendar assets.
- Response-completion pauses: 60–90 seconds, subject to longer scheduler waits.
- Estimate: approximately three minutes if the same preflight stops the attempt;
  roughly 8–15 minutes if it reaches submission and PDF retrieval.
- Stop on any access, throttle, validation, timeout, uncertainty, latency or
  budget barrier; no retry or automatic advancement.

Preparation sent no court requests and did not raise protected limits. The
generic continuation is recorded as permission to prepare and present the exact
scope, not as an approval of undisclosed current-method source requests.
The user subsequently approved this precise scope in the approval form; it was
executed once and is now consumed, as documented below. Earlier permits and
unused budgets were not reused; collection and later stages remain unapproved.

## Separately approved one-PDF v5 attempt — October 6, 2026

**Outcome: FAILED before Search. The public Search Mode dropdown was unnamed.
No PDF requested, no docket information created; staged verification incomplete.**

- Pilot: `0e1010e6-5da4-4168-9ffe-fc18ce802467`.
- Job: `63a2f6fa-32e7-4957-aaa1-91c9952441ec`.
- Approval: “Approve this one-PDF attempt,” with no additional comments.
- Method: `playwright-calendar+urllib-pdf-v5`; urllib was not reached.
- Fixed scope: CP-05-02-Crim / Bail Hearing, October 6–12 inclusive, one PDF,
  nine additional total requests including all assets.
- Approved: `2026-10-06T18:37:54.638Z`.
- Started: `2026-10-06T18:37:59.769Z`.
- Completed: `2026-10-06T18:40:39.428Z`.

| Method/path | Status/outcome | Started (UTC) | Completed (UTC) | Duration | Gap after prior response |
| --- | --- | --- | --- | --- | --- |
| GET `/CaseSearch` | 200 / OK | 18:38:04.056 | 18:38:04.924 | 868 ms | — |
| GET `/resource/css/sitemain.min.css` | 200 / OK | 18:39:35.019 | 18:39:35.373 | 354 ms | 90,095 ms |
| GET `/resource/js/sitemain.min.js` | 200 / OK | 18:40:37.836 | 18:40:37.961 | 125 ms | 62,463 ms |

Both known bundles loaded, zero required-resource blocks/page errors/unclassified
console errors, and two proven optional-abort console errors. The exact form
diagnostic was `CALENDAR_CONTROL_STATE_MISMATCH: SEARCH_MODE / UNNAMED`.
The first failed readback ended validation, so this run does not prove the
remaining controls or actual model-field bindings. It does not demonstrate a
court denial, a submitted search, an empty calendar or supported result scope.

The native Search Mode widget lacked a `name`; the validator assumed every UI
selector was itself the directly submitted field. No DOM/backing-field artifact
was retained, so it cannot be claimed that a specific hidden field exists or
that its value is correct. The source's actual widget/model binding is unproven.

Only three requests were transmitted; all returned 200, completed in less than
one second and were nonoverlapping. Both gaps exceeded the protected 60-second
floor. The 90.095-second gap includes scheduling overhead; the randomized
completion pause itself remains bounded to 60–90 seconds. The job is PAUSED,
calendar incomplete, source-wide `SOURCE_VALIDATION_BARRIER` retained, access
proof and collection approval unset, and no active request. A read-only check
found zero requests after pilot completion. No retry or cap increase occurred.

The initial operator approval command could not start because the ignored build
output was absent. The same v5 source was built before recording approval and
running; that local build issue made no source requests or permit consumption.
The API was restarted after the runner exited.

### Offline v6 native-binding repair

Current method: `playwright-calendar+urllib-pdf-v6`. An unnamed UI selector can
now pass only with a unique, enabled, named hidden backing control in that
selector's own public container and the same form. Both UI and backing values
must match the intended public value; actual native FormData must contain the
backing field exactly once with that value. No native server field name is
invented and no global value match is treated as a binding. Missing, wrong,
disabled, ambiguous or duplicated bindings still stop. Existing named-control,
form-target, date, asset, POST-gate, transport and result checks remain.

Public-control failures are collected together in one readback and emitted only
as fixed control labels/reasons. Unknown, oversized, duplicate-control or
value-bearing diagnostic payloads are rejected. The repair passed 109 offline
safety checks, 16 Python protocol/browser tests, typecheck, build, Python
compilation and whitespace checks. Public form/model fixtures demonstrate this
validator's behavior, not the court's actual markup; no docket/case fixtures or
court requests were used. The source backing layout and successful PDF retrieval
still require fresh live proof. No v6 permit or source request is approved.

### Earlier v6 scope — stale before operator approval

- Pilot: `245bce52-bd1d-4d38-a1a2-cba6dffa75f9`, state `PREPARED`.
- CP-05-02-Crim / Bail Hearing, October 6–12 inclusive.
- One PDF maximum; nine total additional requests including all calendar assets.
- 60–90-second completion pauses, or longer if the shared scheduler requires.
- Estimate: about three minutes if preflight fails; 8–15 minutes if it proceeds
  through Search and PDF retrieval.
- Native backing layout is still unproven. Failure to identify a unique matching
  model binding stops the attempt, as do all other existing barriers.

Preparation sent no source requests, raised no operator caps, and is not an
approval or retry. The failed v5 permit is consumed. No later stage or broader
collection is authorized.

### October 11, 2026 — v6 approval rejected locally, no court traffic

The user explicitly selected “Approve this v6 one-PDF attempt,” with no
additional comments, for the earlier October 6–12 scope. By execution time,
the local clock was `2026-10-12T00:26:55Z`, October 11 in America/New_York.
The operator approval gate rejected the October 6 start as stale. The old
assessment remains `PREPARED`, with no approval/start timestamp, no job/request
history, and no issued or consumed permit. The managed worker was not stopped
and no court request was made. `SOURCE_VALIDATION_BARRIER` remains set and
there is no active request. No historical-date check or protected cap was
bypassed; the application source was not changed.

A replacement exact scope was prepared without source traffic:

- Pilot: `d44f4f99-0052-4baf-8eba-9ae41096cd08`, `PREPARED`.
- Method: `playwright-calendar+urllib-pdf-v6`.
- CP-05-02-Crim / Bail Hearing, October 13–17, 2026 inclusive.
- One PDF maximum; nine total new requests including all calendar assets.
- 60–90-second response-completion pauses, or longer scheduler waits.
- Estimate: about three minutes if preflight stops; 8–15 minutes if it reaches
  Search and PDF retrieval.

The start is two days ahead of the current Eastern date, reducing the chance
that another delayed approval has a stale start. The new dates are a proposal,
not a silent update of the user's earlier approval. Source form support must
still be validated during the authorized attempt; all existing stop rules,
native binding/readback requirements and operator caps remain unchanged.
The user subsequently approved this replacement exact scope. It was executed
once and failed before Search, as documented below. No retry, later-stage
advance or broader collection is authorized.

## October 11 Eastern / October 12 UTC — approved v6 attempt

**Outcome: FAILED before Search; zero PDFs. Native model binding is unresolved.
The staged task remains incomplete. Do not repeat speculative one-PDF pilots.**

- Pilot: `d44f4f99-0052-4baf-8eba-9ae41096cd08`.
- Job: `8842f960-a529-4cd7-a418-636ab4e3f957`.
- Explicit approval: “Approve this October 13–17 attempt,” with no comments.
- Exact method: `playwright-calendar+urllib-pdf-v6`; urllib was not reached.
- Scope: CP-05-02-Crim / Bail Hearing, October 13–17, 2026 inclusive.
- Maximum one PDF, nine total new requests including calendar assets.
- Approved: `2026-10-12T00:39:57.615Z`.
- Started: `2026-10-12T00:40:05.925Z`.
- Completed: `2026-10-12T00:42:47.687Z`.

| Method/path | Status/outcome | Started (UTC) | Completed (UTC) | Duration | Gap after prior response |
| --- | --- | --- | --- | --- | --- |
| GET `/CaseSearch` | 200 / OK | 00:40:24.609 | 00:40:25.513 | 904 ms | — |
| GET `/resource/css/sitemain.min.css` | 200 / OK | 00:41:30.729 | 00:41:30.873 | 144 ms | 65,216 ms |
| GET `/resource/js/sitemain.min.js` | 200 / OK | 00:42:44.740 | 00:42:44.944 | 204 ms | 73,867 ms |

Both required bundles loaded. Required-resource blocks, page errors and
unclassified console errors were zero; two optional-abort console errors were
proven. All three responses were successful, under one second, nonoverlapping,
and spaced beyond the 60-second completion floor.

The complete public readback emitted `BACKING_CONTROL_MISSING` for each of:

- `SEARCH_MODE`
- `JUDICIAL_DISTRICT`
- `COURT_OFFICE`
- `EVENT_TYPE`

In this validator, that reason means no enabled, named **hidden input** associated
with the same form was eligible in that widget's own known public container.
It does not mean the source lacks native model controls elsewhere, or that
other control types or click-time serialization are absent. None of those
alternative layouts was inspected or retained. Do not infer a field name,
input type, placement or native submission strategy from this failure.

The reason is reached only after each UI control's intended value, enabled
state and form association are checked. Both named date inputs produced no
failure in the complete six-control readback, including their local FormData
comparisons. This establishes local public control state, **not** a transmitted
Search, server acceptance of the scope, validated calendar results or PDF access.
The client emitted `SUBMISSION_NOT_OBSERVED` and stopped. No POST, calendar
candidate or PDF was created.

The job is PAUSED with calendar incomplete. The permit is consumed despite six
unused requests. Source-wide `SOURCE_VALIDATION_BARRIER` remains, access proof
and collection approval are unset, and no request is active. A read-only ledger
check found zero requests after completion. The API was restarted after the
runner exited. No cap increase, retry, date expansion or client switch occurred.

### Required next evidence, before another PDF pilot

Stop guessing public widget/model layouts from hypothetical fixtures. No raw
source HTML or submission artifact was retained and the current evidence cannot
resolve the actual model binding offline. A source-backed public form/submission
inspection is needed, with tokens, cookies, sensitive values and raw content
excluded from its retained evidence.

Do not silently broaden the validator to other input types, global value
matches or unverified server field names. An inspection-only operator path
would need to be prepared and checked offline, then receive its own explicit
dates, total request budget and separate approval before any court contact.
Do not use the consumed PDF-stage approval for that inspection. At this
historical checkpoint no inspection permit, additional one-PDF attempt,
three/ten-PDF stage or broader collection was authorized. The later
one-PDF attempt and its outcome are documented below.

### Historical checks immediately after the v1 pilot

- The user approved offline preparation, followed by a separate live inspection
  approval for October 13–17, three total GETs, zero PDFs, and zero transmitted
  Search POSTs. The failed attempt and exact ledger are documented in
  `court-form-inspection.md`.
- Only `GET /CaseSearch` was recorded (HTTP 200, 1,263 ms). It produced no
  document or search-result evidence. The user clarified the research target:
  past court PDFs may show original dockets, while a future scheduled-hearing
  PDF is relevant only if it already shows bail information; in either case the
  same PDF must show the docket number and bail information. Current custody is
  not established by these court records.
- The attempt was interrupted before form inspection. It is FAILED/consumed;
  no retry, assets, Search POST, calendar result, PDF, or candidate followed.
- Recovery left the job PAUSED and `SOURCE_VALIDATION_BARRIER` intact;
  access verification/collection approval remain unset and no request is active.
- Offline implementation checks passed (124 safety checks, 19 Python tests,
  typecheck, build, Python compilation, whitespace checks). They do not prove
  live form submission or access.
- The API worker was restarted and is listening; the public landing page renders.

### Remaining decisions

The three-PDF and ten-PDF stages were not approved or run. Their fresh
prior-stage proof prerequisite is absent. No 100-distinct-match proposal or
sample was started. The pilot currently rejects past dates; it also stops when
the source form's minimum excludes the selected dates. Establish any historical
path offline without bypassing source validation. Keep the source paused and
obtain fresh, exact-scope approval before each future or historical
court-contact stage; the consumed inspection and PDF permits authorize no
further request.

The user proposed October 4–11, 2026 for the first PDF stage. That range is
eight inclusive dates (over the seven-day limit) and starts before the current
date, so the pilot rejects it. No request was made for this scope. Do not
silently shorten or move the window. Historical bail entries inside a
result-linked docket PDF are possible evidence, but do not prove that the
calendar supports past event-date searches.

### October 12, 2026: separately approved SINGLE-stage attempt

- After selecting the upcoming Bail Hearing path, the user separately approved
  a new SINGLE stage for October 13–17, 2026, Common Pleas criminal court
  `CP-05-02-Crim`, with a maximum of one PDF and nine total requests. The
  request budget included the search page, assets, calendar submission and PDF.
  Permit `d96ab610-a698-45b6-9cf4-cd974f360c57` was new; the consumed INSPECT
  permit was not reused. The approved window did not establish that a
  source-supported event range or qualifying PDF would be returned.
- The exact integrated Playwright calendar / urllib PDF stage made only these
  three requests. Every response was HTTP 200 / OK:

  | Request | Started (UTC) | Completed (UTC) | Duration | Delay since prior completion |
  | --- | --- | --- | --- | --- |
  | GET `/CaseSearch` | 2026-10-12 01:46:07.778 | 2026-10-12 01:46:08.862 | 1,084 ms | — |
  | GET `/resource/css/sitemain.min.css` | 2026-10-12 01:47:14.986 | 2026-10-12 01:47:15.185 | 199 ms | 66,124 ms |
  | GET `/resource/js/sitemain.min.js` | 2026-10-12 01:48:42.539 | 2026-10-12 01:48:42.764 | 225 ms | 87,354 ms |

- Both required assets loaded. The retained calendar diagnostic reports zero
  blocked scripts/stylesheets/data requests, zero script errors and zero
  unclassified console errors; two console errors were attributed to proven
  optional-resource aborts. It retains only bounded counts and fixed labels.
- Form validation then stopped the job. The public controls
  `SEARCH_MODE`, `JUDICIAL_DISTRICT`, `COURT_OFFICE` and `EVENT_TYPE` each
  reported `CALENDAR_CONTROL_STATE_MISMATCH: ... / BACKING_CONTROL_MISSING`.
  `CALENDAR_STATE` reported `SUBMISSION_NOT_OBSERVED; search form visible=false`.
  The worker recorded `PAUSE: Source barrier: CALENDAR_CONTROL_STATE_MISMATCH.
  Not an empty search. Completed results retained.`
- The assessment is `FAILED`; its report records three requests, zero valid
  documents and zero request failures. No calendar Search POST, result,
  calendar candidate, PDF retrieval or docket candidate followed. Permit and
  six unused request slots are consumed and are not authorization to retry.
- The job is `PAUSED`; `SOURCE_VALIDATION_BARRIER` remains, access verification
  and collection approval are unset, and no request is active. The API Server
  workflow was restarted after the runner exited and is listening.
- At that point, no further request was authorized. A later, separately
  approved read-only INSPECT stage and its result are recorded below. It did not
  authorize a replacement SINGLE stage.

### October 12, 2026: separately approved read-only INSPECT stage

- After the SINGLE form-state barrier, the user separately approved a fresh
  INSPECT permit for October 13–17, 2026, with a ceiling of three GETs and zero
  remote POSTs or PDFs. Permit `3c781bc3-1052-47af-8928-56713df3b5e4` was new;
  the earlier failed INSPECT permit was not reused.
- The client completed its source form's minimum-date guard for October 13,
  then made exactly three successful GET requests:

  | Request | Started (UTC) | Completed (UTC) | Duration | Delay since prior completion |
  | --- | --- | --- | --- | --- |
  | GET `/CaseSearch` | 2026-10-12 01:58:36.143 | 2026-10-12 01:58:36.996 | 853 ms | — |
  | GET `/resource/css/sitemain.min.css` | 2026-10-12 01:59:42.340 | 2026-10-12 01:59:42.717 | 377 ms | 65,344 ms |
  | GET `/resource/js/sitemain.min.js` | 2026-10-12 02:00:55.829 | 2026-10-12 02:00:56.032 | 203 ms | 73,112 ms |

- All six expected public controls were present, enabled, associated with the
  same form, and matched their scoped values. The four selector widgets were
  unnamed UI controls, each with exactly one named text control inside its own
  widget container and the same form; each native value matched once in
  `FormData` and once in the locally intercepted form submission. The two date
  controls were named date inputs and likewise matched once. The validator
  retained only fixed labels, types, booleans and counts—not field names,
  values, HTML, tokens or raw console text.
- The form's local Search click was captured and aborted before transport or
  request-budget reservation. There was no remote Search POST, calendar result,
  PDF, candidate or source record. The assessment is `INSPECTED`, not
  `VERIFIED`; its report explicitly says this is not calendar/PDF access proof.
- The inspection job completed with three requests and zero documents. The
  source remains at `SOURCE_VALIDATION_BARRIER`; access verification and
  collection approval remain unset, with no request active. The API Server
  workflow was restarted afterward.
- A narrow offline validator revision now accepts the observed named text
  control only when it is unique, inside its expected widget container,
  associated with the same form, and its exact value occurs once in that
  form's `FormData`. Offline Python, safety, TypeScript and build checks pass.
  This code change is not new calendar/PDF access proof.
- A replacement SINGLE attempt has not been approved or run. It must use a new
  permit and receive separate approval, including its total request budget.
  SMALL/MODEST, broader collection and the 100-docket proposal/sample remain
  unstarted.

### October 12, 2026: separately approved v6 SINGLE attempt after inspection

- The user separately approved permit `dedabcf5-fe4b-4206-8602-c999ec215c05`,
  job `cf902fdd-1613-4e71-b7bb-450d6857cd78`, for October 13–17, one PDF
  maximum and 12 total requests including the page, assets, calendar POST and
  PDF. The 12-request ceiling was the existing protected cap. Approval:
  `2026-10-12T02:11:38.160Z`; started:
  `2026-10-12T02:11:47.804Z`; completed:
  `2026-10-12T02:14:26.167Z`.
- The exact integrated `playwright-calendar+urllib-pdf-v6` client made exactly
  three requests, all GETs with HTTP 200 / OK:

  | Request | Started (UTC) | Completed (UTC) | Duration | Gap since prior completion |
  | --- | --- | --- | --- | --- |
  | GET `/CaseSearch` | 2026-10-12 02:11:49.125 | 2026-10-12 02:11:50.523 | 1,398 ms | — |
  | GET `/resource/css/sitemain.min.css` | 2026-10-12 02:13:01.210 | 2026-10-12 02:13:01.383 | 173 ms | 70,687 ms |
  | GET `/resource/js/sitemain.min.js` | 2026-10-12 02:14:24.154 | 2026-10-12 02:14:24.408 | 254 ms | 82,771 ms |

- Both known assets loaded; blocked required resources, script errors,
  unclassified console errors and request failures were zero. The client passed
  its form date-minimum guard, then stopped before transmitting Search. The
  persisted form diagnostic recorded `BACKING_CONTROL_MISSING` for
  `SEARCH_MODE`, `JUDICIAL_DISTRICT`, `COURT_OFFICE` and `EVENT_TYPE`.
  `CALENDAR_STATE` reported `SUBMISSION_NOT_OBSERVED; search form visible=false`.
- The assessment is `FAILED`: three requests, zero valid documents, zero
  request failures. There was no remote Search POST, calendar result, calendar
  candidate, PDF or docket candidate. The permit and nine unused request slots
  are consumed. The job is paused, `SOURCE_VALIDATION_BARRIER` remains, access
  verification and collection approval are unset, and no request is active.
  The API workflow was restarted after the runner exited.
- This conflicts with the preceding INSPECT evidence, which found one named
  same-form text backing control within each selector widget and an exact local
  `FormData`/intercepted-submission match. The inspection counts the normalized
  DOM `field.type` property, not whether the original input had an explicit
  `type` attribute; raw markup was not retained. The v6 CSS selector required
  `[type="text"]`. An input lacking that attribute defaults to `.type ===
  "text"` but does not match that CSS attribute selector. This is a plausible
  explanation for the mismatch, not a proven fact about the unretained markup.
- The offline validator now selects named inputs in the already-validated
  widget container and filters by the DOM `type` property (`hidden` or `text`),
  retaining same-form association, uniqueness, exact value and single-value
  `FormData` checks. The integrated client identity is now v7, invalidating
  v6 proof/permits. Regression tests cover an implicit default-text input as
  well as explicit text, hidden and rejected unsupported types. Offline
  verification passes: 19 Python tests, 124 safety checks, typecheck, build and
  whitespace check. This is not new source-access proof.
- A fresh v7 SINGLE permit was prepared after the offline fix:
  `6c5cd4d2-b2af-41f2-8863-e9c7e567b5be`, state `PREPARED`,
  `expectedMethod=playwright-calendar+urllib-pdf-v7`, CP-05-02-Crim / Bail
  Hearing, October 13–17, one PDF maximum and 12 total requests. It has no
  approval, start or job timestamp; preparation made no source requests.
  A separate approval of this exact scope is still required before running it.
  The three-/ten-PDF stages and the 100-docket proposal/sample remain unstarted.

### October 12, 2026: separately approved v7 SINGLE attempt

- The user separately approved the v7 permit
  `6c5cd4d2-b2af-41f2-8863-e9c7e567b5be`, job
  `32f91eef-b1b3-4e22-a6c2-1a8783d6590d`, for October 13–17, one PDF maximum
  and 12 total requests. Approval: `2026-10-12T02:42:51.041Z`; start:
  `2026-10-12T02:42:58.163Z`; completion: `2026-10-12T02:46:44.925Z`.
- The integrated `playwright-calendar+urllib-pdf-v7` client made three
  successful GETs, all HTTP 200 / OK:

  | Request | Started (UTC) | Completed (UTC) | Duration | Gap since prior completion |
  | --- | --- | --- | --- | --- |
  | GET `/CaseSearch` | 2026-10-12 02:43:14.214 | 2026-10-12 02:43:15.153 | 939 ms | — |
  | GET `/resource/css/sitemain.min.css` | 2026-10-12 02:44:23.560 | 2026-10-12 02:44:23.681 | 121 ms | 68,407 ms |
  | GET `/resource/js/sitemain.min.js` | 2026-10-12 02:45:39.349 | 2026-10-12 02:45:39.460 | 111 ms | 75,668 ms |

- The form passed validation; the event ledger recorded `FORM_READY` at
  `02:45:41.459Z`. All known assets were loaded and blocked required resources,
  script errors and unclassified console errors were zero. No Search POST or
  PDF request appears in the persisted request ledger. After the click phase,
  the client emitted `SUBMISSION_NOT_OBSERVED` and stopped with
  `UNEXPECTED_RESPONSE`; it did not produce a validated calendar result or
  candidate.
- The assessment is `FAILED`, with three requests, zero valid documents and zero
  request failures. The permit and nine unused slots are consumed. The job is
  paused, `SOURCE_VALIDATION_BARRIER` remains, access verification and
  collection approval are unset, and no request is active. The API workflow
  restarted afterward.
- The interval from `FORM_READY` to the result diagnostic was 60.021 seconds.
  The worker's browser default click timeout is 60 seconds, while the routed
  request waits 60–90 seconds after the prior response before it can be
  transmitted. This timing plus the absent POST ledger is consistent with the
  click timing out locally during request pacing; the raw Playwright exception
  was not retained, so its exact type is not proven. No court refusal or
  response to a Search was observed.
- Offline v8 changes the Search click and navigation wait to one bounded
  180-second timeout, longer than the maximum pacing wait plus the configured
  request timeout. A network-blocked Playwright test delays a locally
  intercepted POST beyond the page's short default timeout and confirms that
  the explicit bounded click timeout completes navigation. Integrated method
  identity is now `playwright-calendar+urllib-pdf-v8`, so v7 approvals/proofs
  cannot be reused. Verification passes: 20 Python tests, 124 safety checks,
  typecheck, build and whitespace check.
- A fresh v8 SINGLE permit was prepared and separately approved:
  `a7734b57-e36f-4232-bfc6-1c3ab56f771d`, method
  `playwright-calendar+urllib-pdf-v8`. Its exact scope was CP-05-02-Crim / Bail
  Hearing, October 13–17, one PDF maximum and 12 total requests, including all
  page/assets, Search and PDF requests. The expected inventory was about seven
  requests, with the remaining budget reserved for additional required assets.
  The estimate was roughly 8–20 minutes if it reached one PDF, with longer
  adaptive waits possible. This permit is now consumed and failed, as detailed
  below. No three-/ten-PDF stage, collection approval or 100-docket proposal/
  sample has started.

### October 12, 2026: separately approved v8 SINGLE attempt

**Outcome: FAILED after Search; no validated calendar result, candidate or PDF.
Court access remains unverified. Stop here; do not retry or advance stages.**

- Permit: `a7734b57-e36f-4232-bfc6-1c3ab56f771d`.
- Job: `b25c9b18-c157-4d8f-b58c-358a0c0ce9ec`.
- The user separately approved this exact v8 one-PDF scope; no comments.
- Scope: CP-05-02-Crim / Bail Hearing, October 13–17 inclusive; maximum one
  PDF and 12 total requests including every page, asset, Search and PDF request.
- Approved: `2026-10-12T13:14:50.528Z`.
- Started: `2026-10-12T13:15:00.051Z`.
- Completed: `2026-10-12T13:20:37.839Z`.

| Method/path | Status/outcome | Started (UTC) | Completed (UTC) | Duration | Gap after prior response |
| --- | --- | --- | --- | --- | --- |
| GET `/CaseSearch` | 200 / OK | 13:15:05.944 | 13:15:06.733 | 789 ms | — |
| GET `/resource/css/sitemain.min.css` | 200 / OK | 13:16:09.613 | 13:16:09.854 | 241 ms | 62,880 ms |
| GET `/resource/js/sitemain.min.js` | 200 / OK | 13:17:36.016 | 13:17:36.358 | 342 ms | 86,162 ms |
| POST `/CaseSearch` | 200 / OK | 13:18:57.981 | 13:19:00.103 | 2,122 ms | 81,623 ms |
| GET `/resource/css/sitemain.min.css` | 200 / OK | 13:20:09.494 | 13:20:09.604 | 110 ms | 69,391 ms |

- The form passed the v8 control checks and emitted `FORM_READY`. The Search
  POST was transmitted and returned HTTP 200; that establishes transport only.
  The result-phase diagnostic reported both known assets loaded, zero blocked
  required resources, zero script errors, one unclassified console error and
  three proven optional-abort console errors. No raw response, console text,
  page content or row identifiers were retained.
- The client emitted `RESULTS_NOT_VALIDATED`, followed by
  `UNEXPECTED_RESPONSE: Not an empty search. Completed results retained.`
  No validated result set, supported-empty result, docket candidate or PDF
  request was recorded. The saved evidence does not establish the cause of the
  unclassified console error or the result-validation failure; do not infer an
  empty calendar, court denial, qualifying docket or successful source access.
- The assessment is `FAILED`: five requests, zero transport failures and zero
  valid documents. The permit and seven unused request slots are consumed.
  The job is paused, `SOURCE_VALIDATION_BARRIER` remains, access verification
  and collection approval are unset, and no request is active. The API workflow
  restarted after the runner exited.
- The validation barrier is the required stop point. No retry, three-PDF or
  ten-PDF stage, collection enablement or 100-docket proposal/sample is
  authorized by this failed attempt. Any future work needs fresh analysis and
  its own exact scope, request budget and explicit approval.

### October 18, 2026: request-allocation accounting clarification

- The current same-date v5 permit `0812596c-20db-42d6-b5eb-8d2aab8ba652`
  and v6 permit `0af27cb8-f6c0-454c-871c-9ce4b26f07fc` are separate failed
  one-use authorizations. Each stored a 12-request per-permit cap and has four
  request-ledger entries: `GET /CaseSearch`, the known CSS and JavaScript
  asset GETs, and `POST /CaseSearch`.
- The earlier October 12 approval record above likewise applies its 12-request
  cap to one permit and one-PDF scope. No shared twelve-request allocation
  across matching date criteria was found. The permits and all eight requests
  remain unchanged; historical usage is still included in source-wide rolling
  hourly/daily quotas while in those windows.
