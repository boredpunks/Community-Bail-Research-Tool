# Bounded engine execution — October 16, 2026

## Recorded authority and exact scope

The user's instruction in
`attached_assets/Pasted-Understood-You-are-authorizing-retrieval-not-just-anoth_1792178074885.txt`
explicitly authorizes execution, including public-control observation, calendar
submission/results and validated docket-document retrieval/extraction/pending
storage through supported scoped permits. Successful stages need fresh permits,
not another conversational approval. A consumed failed attempt requires fresh
user approval before another source attempt.

- Judicial district: Allegheny - 05.
- Court office: CP-05-02-Crim.
- Event type: Bail Hearing.
- Intended courtroom: Courtroom 506. Never substitute no filter or another room.
- Chosen window: **2026-10-16 through 2026-10-22**, seven days inclusive,
  beginning today in America/New_York. This is not historical-coverage authority.
- Overall ceiling for this execution: **30 transmitted requests, five distinct
  docket documents**. Failed/uncertain transmissions count. Existing stricter
  job/operator/hour/day ceilings prevail; no ceiling is raised.
- One concurrent request. Existing response-completion pacing, 60–90-second
  worker waits, adaptive slowdown and cooldown remain enforced.
- Stop on denial/challenge/rate limit, unexpected redirect, uncertain state,
  unvalidated criteria/results, identity mismatch, exhaustion or an unsupported
  access method. No alternate clients/hosts, retries or barrier-clear command.

## First stage: public courtroom observation

Current corrected method: `playwright-public-courtroom-observation-v2`, carried by the existing
one-use `COVERAGE` permit, not a new permit type.

Only these destinations are allowed, at most one GET each, **three transmitted
requests total**, and zero transmitted POSTs/documents:

1. `https://ujsportal.pacourts.us/CaseSearch`
2. `https://ujsportal.pacourts.us/resource/css/sitemain.min.css`
3. `https://ujsportal.pacourts.us/resource/js/sitemain.min.js`

The existing permitted single `v` asset-version query remains allowed.
Bootstrap retrieval uses the existing coverage worker/parent accounting,
response classification/size policy and no-redirect/no-retry transport. This is
the coverage route gate, **not** the disabled INSPECT sandbox or a claim of
host-level isolation. Those frozen safeguards are not modified.

After bootstrap, all nonoptional dependent requests are aborted locally and
stop observation. Local interactions are limited to choosing Calendar Event,
Allegheny - 05, CP-05-02-Crim and Bail Hearing, then identifying the room from
its public label/ARIA association and actual form structure. Courtroom 506 may
be selected once locally if the exact available option is uniquely established.
No Search click, submission, date entry, results or PDF retrieval.

Deadline: **480 seconds overall**, with at most **15 seconds** for local room
initialization/binding observation. Existing 45-second source fetch timeouts
remain. The parent kills the worker process group at the overall deadline;
consumed/uncertain accounting is preserved, not replayed.

Only fixed outcomes, counts and booleans are retained. Source field names/IDs,
private option values, tokens, raw HTML, screenshots and arbitrary logs are not.
Native binding is proved in memory by exact same-form ownership and unique
FormData value readback against the selected public option. Missing labels are
reported as `CONTROL_NOT_EXPOSED`, not proof the source globally lacks a filter.
Disabled/busy/uninitialized controls, unavailable 506, ambiguous association and
unproved binding have distinct diagnostics. None authorizes a broader search.

The source-wide `SOURCE_VALIDATION_BARRIER` is required and remains unchanged.
Observation does not prove access, validate a calendar, or enable collection.

## Offline verification before source execution

- 725 parent/scheduler/protocol checks passed, using an isolated database schema.
- 79 Python tests passed, including seven added actual-worker observation tests.
- The new tests use public control-only HTML, never invented court cases.
- Tests cover named and replaced unnamed controls, delayed initialization,
  missing/disabled/unavailable rooms, ambiguous native backing, blocked
  dependent requests, and exclusion of source identities/values from diagnostics.
- API/frontend type checks passed.
- Build and live execution evidence will be recorded below when obtained.

## Execution ledger

No request or document is counted as validated merely from HTTP 200.
Each stage's permit/job IDs and retained request counts will be recorded here.

### First observation — failed, not retried

- Executed method: `playwright-public-courtroom-observation-v1`.
- Permit: `ba12b357-7b7f-46f8-baf0-ceb945e40e33` (consumed, FAILED).
- Job: `39ea0438-c884-4994-94e1-27db6fe9b675` (PAUSED).
- Execution: 2026-10-16 19:29:50–19:33:18 UTC.
- Exactly three GETs, all HTTP 200 / accounted OK: form 1,326 ms,
  stylesheet 2,657 ms, script 2,951 ms.
- Gaps after previous response completion: 87.286 and 82.411 seconds.
- Required resources loaded; zero blocked required resources, script errors or
  unclassified console errors. Two console errors were proven optional aborts.
- Worker stopped with `UNEXPECTED_RESPONSE` before courtroom metadata.
  No Search submission, results, PDFs, extraction or pending observations.
- Source barrier retained; no active request, cooldown, access verification,
  collection approval or latency warning remained.
- **Overall execution budget consumed: 3/30 requests, 0/5 documents.**

Offline diagnosis reproduced `ModuleNotFoundError` from the actual built
runtime: its explicit Python copy list omitted the new observation module.
This explains the failure, not the source's courtroom structure or availability.
The diagnosis was added to the retained job's `OFFLINE_DIAGNOSIS` event without
changing its failed permit, request history or source state.

The corrected build includes the module and verifies actual packaged imports.
The worker now checks plugin availability before starting a browser or making
any source request. An isolated fresh-interpreter test runs eight scenarios
against the built worker, including zero-browser/zero-request behavior when
the plugin is missing. Those built-worker checks passed.

Both API and frontend builds/type checks passed. The final full regression run
against executable code committed as `252671d` passed: **725 parent checks and
81 Python tests** (289.962 seconds), including the fresh-interpreter built-worker
scenarios.

### Corrected observation — completed with binding established

The user explicitly approved the corrected observation, with no added comments.

- Method: `playwright-public-courtroom-observation-v2`.
- Permit: `9714fc15-4fca-41cd-b97c-d390d691203b` (consumed, INSPECTED).
- Job: `57ea133f-f814-44de-b59d-da530beb6c86` (COMPLETED).
- Execution: 2026-10-16 20:45:41–20:48:03 UTC.
- Three GETs, all HTTP 200 / accounted OK: form 820 ms, stylesheet 357 ms,
  script 248 ms. Completion-to-next-start gaps: 69.192 and 63.981 seconds.
- Outcome: **BOUND_506**. One public room label/control, enabled and owned by the
  search form after criteria selection, 104 options, exactly one enabled 506
  option, one native binding, selected 506 and matching native FormData value.
  Binding stabilized; local observation took 1,043 ms.
- No Search, calendar rows, documents, extraction or pending observations.
- Source barrier retained; no active request, cooldown, access verification,
  collection approval or latency warning remained.
- **Overall budget consumed: 6/30 requests, 0/5 documents.**

### Offline repair and scoped engine continuation

Current calendar methods rediscover Courtroom 506 from the same public-label
probe instead of assuming a named select. They select it after the approved
office/event sequence, prove native binding, and rediscover/revalidate it after
date entry, before Search. The frozen inspection validator and observation
method remain unchanged. Named and unnamed/backed public-form fixtures test
selection and rejection of a late value change, with all network blocked.

Calendar preview method is now `playwright-calendar-preview-v6`; integrated
method is `playwright-calendar+urllib-pdf-v11`. Historical proofs are not reused.

A new one-use `BOUNDED_ENGINE` assessment uses
`playwright-calendar+urllib-pdf-v11-bounded-506-v1`. Unlike the existing staged
integrated pilot, it **never clears the global source barrier or grants access
proof/collection approval**. It requires matching sanitized BOUND_506 evidence,
the exact saved criteria, fresh explicit operator approval, the worker lease,
and the unchanged idle source barrier. Per-transmission checks retain exact
permit/job equality, expiry, pacing, rolling budgets, source stops and accounting.
One Search POST, unique bootstrap GET paths, validated source-linked document
identity/order, no repeated document attempt, and five document attempts maximum.
The stricter job ceiling is **12 requests**, below the remaining aggregate 24.

Valid retained evidence can be saved through `save-bounded-results` using the
existing eligibility, observation construction, pending-review defaults and
unique evidence keys. Missing bail remains unknown, not zero. Failed or
unvalidated items are never saved. No source traffic occurs during saving.

Offline checks: **756 parent/protocol/scheduler checks passed** after updating
two obsolete preview-scope test expectations; **82 Python tests passed**
(202.222 seconds), including public binding selection/final-validation checks.
API/frontend type checks, API build and packaged Python imports passed.
The API contract now exposes the scoped engine stage/report without exposing
operator-only diagnostics or representing bounded completion as VERIFIED.

Prepared engine permit: `d540c718-5720-4ae7-83e6-9c8cac0e7c93`.

### Bounded engine attempt — submitted, response not validated

- Executable code: `17acad7`. Permit:
  `d540c718-5720-4ae7-83e6-9c8cac0e7c93` (consumed, FAILED).
- Job: `ce959474-89f6-4210-bb7b-72e828489ded` (PAUSED).
- Execution: 2026-10-16 20:57:11–21:00:51 UTC.
- Four transmissions, all HTTP 200 / accounted OK:
  - GET form: 1,306 ms.
  - GET stylesheet: 231 ms.
  - GET script: 221 ms.
  - POST Search: 2,029 ms.
- Completion-to-next-start gaps: 72.459, 74.146 and 63.790 seconds.
- `FORM_READY` established before Search: approved office/event/room/date
  controls and native bindings passed final validation. No presumed room selector.
- Bootstrap/READY had zero blocked required resources, page errors or
  unclassified console errors; two proven optional-abort console errors.
- After the POST: zero blocked required resources/page errors, **three
  unclassified console errors**, four proven optional-abort errors, two cached
  asset responses. `CALENDAR_CONSOLE_ERROR` stopped processing at the existing
  pre-parser gate.
- No results were validated. This is **not** a validated empty search. No
  calendar row, docket document, extraction or pending observation was obtained.
- Retained diagnostics contain counts only. Error messages and locations were
  deliberately not retained, so neither the actual error categories nor their
  source/local cause can be established offline. Do not relabel the three as
  harmless, infer a rate limit, or claim a source defect.
- Source remains `SOURCE_VALIDATION_BARRIER`, with no active request, cooldown,
  access proof, collection approval or latency warning.
- **Overall execution consumed: 10/30 requests, 0/5 documents.** No automatic
  retry, replay, barrier clearing, alternate client or new live permit.

The exact resulting executable code passed 756 parent/scheduler checks.
Its unchanged Python code passed the 82-test run above; API/frontend type checks
and builds passed. Frontend production build used the artifact's configured
PORT/BASE_PATH after a bare shell invocation correctly rejected missing PORT.
Managed services are running; API health returned 200; the public app screenshot
rendered correctly. This does not establish the signed-in results path or
positive live extraction.

**The end-to-end objective remains incomplete at a demonstrated validation
barrier.** Another source attempt requires fresh user approval. Root-cause work
must first improve bounded, redacted diagnostic discrimination offline, not
weaken the console gate or repeat the consumed run unchanged.

## Post-submission diagnostic repair — no live authority

The user's subsequent instruction in
`attached_assets/Pasted-The-run-got-further-Courtroom-506-is-bound-correctly-an_1792184816574.txt`
authorizes this offline diagnostic/policy repair only, **not source requests**.
The prior unused 20-request balance is not continuing execution permission.
The calendar/document/bail objective remains open.

### What the retained evidence establishes

The actual stop was `calendar_preflight("RESULT")`, calling
`calendar_asset_barrier(...)`; its three unclassified console errors produced
`CALENDAR_CONSOLE_ERROR` before `CalendarResults.feed()` or `validated()` ran.
The Search POST body had arrived, been read and classified OK by the existing
transport/content policy, and was fulfilled into the browser. Required known
assets were loaded or served from the session's exact cache. This is transport
evidence, **not inspection/validation of result structure**.

No page exceptions or blocked required requests were recorded. Four other
console errors had exact session-optional-abort proof. The three unclassified
errors cannot be attributed to required resources, deliberate optional aborts,
application execution or another origin from historical counts. Their text
and locations cannot be recovered. They were the **reason validation stopped**,
not an established cause of search failure. No result/empty outcome, document
or extraction was established.

### Integrated repair

- Normal calendar methods now keep bounded in-memory error groups keyed by
  category, READY/RESULT phase, fixed resource alias and fixed signal; at most
  32 groups and 10,000 observations per group, with overflow explicitly flagged.
- Categories distinguish JS exceptions, required-resource failures, optional
  resource errors with exact session-abort proof, other console errors and
  unknown/unsafe messages. Resource aliases are institutional constants, not
  source URLs. Arbitrary text, stack traces, query strings, tokens, credentials,
  private widget values and case content are never retained in diagnostics.
- The optional classification still requires both a deliberately aborted
  resource from this session and an exact demonstrated browser abort signature.
  An arbitrary error at the same URL is not exempt. All other console errors
  and page exceptions remain fail-closed for record acceptance.
- A post-response unknown/other console error or exception immediately blocks
  new browser transmissions. Pending routes recheck before requesting a grant
  and before transport. A grant already waiting at the parent is conservatively
  consumed/accounted as uncertain if it cannot be used after the stop; it is
  never transmitted or reused.
- Where transport completed, no source stop is active and no request is in
  flight, a fixed passive DOM projection records body/form presence, result-table
  multiplicity, bounded header/row/link counts and expected-header booleans.
  No HTML, cell text, docket identifiers or URLs are returned by this probe.
  It has a 1.5-second deadline and a 10,000-element traversal ceiling.
- Source/access stops and in-flight traffic are not inspected through.
  Inspection unavailable, bounds exceeded or classifier overflow prevents
  acceptance. Duplicate/missing result tables are not accepted.
- Unknown errors may allow this passive structural diagnosis, **not result
  acceptance or PDF retrieval**. Proven optional noise alone does not block the
  parser. Header-only tables still do not establish zero matches. A late-error
  check occurs before any validated calendar checkpoint.
- A strict parent validator checks the complete versioned wire envelope, exact
  keys, categories, aliases, phases, bounds and basic consistency before
  retaining `CALENDAR_RESPONSE_DIAGNOSTIC`. Parser-attempt/outcome metadata stays
  distinct from structure-only evidence and the stop gate.
- The existing completed Courtroom 506 observation, public-label binding,
  disabled/frozen inspection paths, broker/sandbox protections, transport
  clients, pacing, quotas, source barrier and consumed permit histories remain.

Current methods: `playwright-calendar-preview-v7`,
`playwright-calendar+urllib-pdf-v12`, and
`playwright-calendar+urllib-pdf-v12-bounded-506-v2`.
The packaged worker imports the new diagnostic module before source access.

Regression coverage uses only public-form/header-only fixtures and loopback
transport substitution, never synthetic docket/case records. Cases include
deliberate optional aborts, required-script HTTP failure, page exceptions,
other/unknown-origin console errors, returned forms, missing grids, malformed
headers, post-stop data requests, sanitization and actual-worker/parent wire
acceptance. These fixtures **do not reproduce or explain the historical live
messages**.

### Proposed fresh execution (not approved or run)

- Same exact criteria: Allegheny - 05 / CP-05-02-Crim / Bail Hearing /
  **Courtroom 506**, **2026-10-16 through 2026-10-22**, inclusive.
- A new one-use bounded-engine permit is required for the current method.
- Fresh total ceiling: **12 source requests**, including form/assets, Search,
  documents and failed/uncertain attempts; **at most five distinct documents**.
  These are ceilings, not targets. Stricter operator/rolling limits prevail.
- One request at a time, existing 60–90-second completion-based pauses,
  adaptive slowdown and cooldowns. No accelerated pacing or automatic retries.
- Stop on denial/challenge/rate limit, unexpected redirect, uncertain state,
  required-resource/runtime or unclassified-console validation stops,
  unavailable/oversized diagnostics, unvalidated criteria/results, identity
  mismatch, exhausted budgets, or unsupported access.
- Only validated calendar dockets, in returned order, through existing document
  links/routes. Preserve source-backed partial evidence and multiple bail entries;
  unknown amount is not zero. Eligible observations are saved pending review only.
- Keep the global source barrier and all prior failed permits unchanged.
- This is a **new approval decision**, not use of the old remaining balance.
