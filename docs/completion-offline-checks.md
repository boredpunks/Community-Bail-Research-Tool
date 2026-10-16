# Completion work: offline evidence and stop points

## Final multi-day result handoff correction

Completion checking found two remaining date-handoff defects: the parser
validated the display date but emitted the original text, and the parent
restricted preview result dates to the window's first day. The parser now
emits the validated ISO date; the parent validates the inclusive start/end
range. All identity, link, event and coverage checks remain in place.

A new offline cross-language test calls the parser's actual date-only row
projection and sends its output through the exact date guard used by the
parent worker. It covers first, middle and final days of a seven-day window,
including source date/time display text, and rejects missing preview dates,
display-format wire dates, invalid dates and both out-of-window boundaries.
It also retains filing-date validation. Only date cells are populated: no
fabricated docket, case identity, result row or source-access claim is used.

Latest actual output (both commands exited 0):

```text
$ PORT=5173 BASE_PATH=/ pnpm run build
> workspace@0.0.0 build /home/runner/workspace
> pnpm run typecheck && pnpm -r --if-present run build

scripts typecheck: Done
artifacts/community-bail-research typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/api-server typecheck: Done
artifacts/mockup-sandbox build: ✓ built in 1.45s
artifacts/mockup-sandbox build: Done
artifacts/api-server build: ⚡ Done in 950ms
artifacts/api-server build: Done
artifacts/community-bail-research build: ✓ built in 3.36s
artifacts/community-bail-research build: Done
```

```text
$ pnpm --filter @workspace/api-server run test:safety
> @workspace/api-server@0.0.0 test:safety /home/runner/workspace/artifacts/api-server
> node ./tests/run-safety.mjs

PASS: 497 offline checks; actual concurrent PostgreSQL grants; no court traffic or case fixtures.
----------------------------------------------------------------------
Ran 66 tests in 107.515s

OK
```

Full output is in `/tmp/selectable-calendar-date-handoff-build.log` and
`/tmp/selectable-calendar-date-handoff-safety.log`. The existing non-fatal
build warnings remain as described below. All loopback observations still
record `shutdownErrors: []`. The managed API was restarted once for this
final batch; the frontend did not change. No source requests, valid permit
preparations, approvals, barrier changes or deployment occurred.

## Selectable criteria: authorized offline correction now passes

October 16, 2026: the user approved **“Fix the offline incompatibilities and
rerun.”** The stored JSON criteria TypeScript type now matches the observed
calendar office choices and singular Preliminary Arraignment. No column,
database migration, record or approval was changed.

The loopback timeout fixture reused diagnostic placeholders (`SEARCH_MODE`,
`JUDICIAL_DISTRICT`, `COURT_OFFICE`, `EVENT_TYPE`) as displayed option labels.
The selectable worker correctly requires exact public labels. Only that local
fixture's displayed labels were corrected to the documented public labels.
No production selector, validation, source layout assumption or assertion
was weakened to make the tests pass.

Actual passing command output (excerpts; all three commands exited 0):

```text
$ pnpm run typecheck
> workspace@0.0.0 typecheck /home/runner/workspace
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck

> workspace@0.0.0 typecheck:libs /home/runner/workspace
> tsc --build

Scope: 4 of 9 workspace projects
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/community-bail-research typecheck$ tsc -p tsconfig.json --noEmit
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck: Done
artifacts/api-server typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/community-bail-research typecheck: Done
```

```text
$ PORT=5173 BASE_PATH=/ pnpm run build
> workspace@0.0.0 build /home/runner/workspace
> pnpm run typecheck && pnpm -r --if-present run build

artifacts/mockup-sandbox build: ✓ built in 1.86s
artifacts/mockup-sandbox build: Done
artifacts/api-server build: ⚡ Done in 356ms
artifacts/api-server build: Done
artifacts/community-bail-research build: ✓ 1826 modules transformed.
artifacts/community-bail-research build: ✓ built in 3.44s
artifacts/community-bail-research build: Done
```

The full build also emitted non-fatal warnings about the mockup image reference,
API bundle size and an unresolved tooltip sourcemap location. These are not
failed build claims. Complete typecheck and build output is in the session
logs `/tmp/selectable-calendar-typecheck-corrected.log` and
`/tmp/selectable-calendar-build.log`. No dependencies changed or were installed.

```text
$ pnpm --filter @workspace/api-server run test:safety
> @workspace/api-server@0.0.0 test:safety /home/runner/workspace/artifacts/api-server
> node ./tests/run-safety.mjs

PASS: 487 offline checks; actual concurrent PostgreSQL grants; no court traffic or case fixtures.
----------------------------------------------------------------------
Ran 66 tests in 111.879s

OK
```

The complete safety output, including actual OFFLINE_REPRODUCTION observations,
is in `/tmp/selectable-calendar-safety-corrected.log`. Those observations show:

- Changed asset version: parser reached; five loopback requests, one cached
  response; the header-only table remains `RESULTS_NOT_VALIDATED`.
- Missing grid: four loopback requests, two cached responses, one
  `BrowserTimeout`, exact barrier `CALENDAR_RESULT_LOAD_TIMEOUT`.
- Identical assets: parser reached; four loopback requests and two cached
  responses; the header-only table remains `RESULTS_NOT_VALIDATED`.
- All three observations: `shutdownErrors: []`; no invented empty-result proof.

The built CLI was exercised only with deliberately invalid criteria, never a
valid preparation command. A local assertion runner invoked
`pnpm --filter @workspace/api-server run pilot prepare-calendar-only` with all
four criteria flags for each rejection and required exit 1 with
`INVALID_CALENDAR_CRITERIA`. Actual runner output:

```text
PASS: CLI rejected past date with INVALID_CALENDAR_CRITERIA before permit preparation.
PASS: CLI rejected eight-day window with INVALID_CALENDAR_CRITERIA before permit preparation.
PASS: CLI rejected unknown office with INVALID_CALENDAR_CRITERIA before permit preparation.
```

`git diff --check` exited 0 with no output. The managed API and web workflows
were each restarted once after the correction and started successfully:

```text
⚡ Done in 372ms
[08:03:15.229] INFO (13091): Server listening
    port: 8080
VITE v7.3.6  ready in 269 ms
```

The development API health route returned:

```text
{"status":"ok"}
HTTP 200
```

A screenshot of `/discovery` rendered the existing signed-out landing gate
without browser errors; it does not verify authenticated interactions. The
generated contracts, input handling and offline form behavior were checked
through the build, typecheck and safety suite rather than any live search.

**Current status:** selectable calendar criteria pass offline verification.
No court requests, valid permit preparations, approvals, barrier changes,
source DNS lookups, PDF downloads or deployment occurred. All frozen
infrastructure and approval gates remain unchanged. Filing-date/MDJ search is
not implemented by this work. Live source/PDF milestones remain separately
untried and separately approval-gated.

## Selectable-criteria first attempt: historical verification failures

October 16, 2026, before the authorized correction above: selectable calendar
criteria were partially implemented, **not complete**. Verification stopped
under the user's explicit stop-on-failure rule.
The earlier v9 passing results below describe the prior implementation, not a
passing claim for this working tree. No further implementation, build, workflow
restart or live verification followed these failures. No court request, new
permit, approval, source-barrier clearing or deployment occurred.

Orval codegen completed successfully. Actual verification output excerpts:

```text
$ pnpm run typecheck
artifacts/api-server typecheck: src/routes/discovery.ts(93,55): error TS2769: No overload matches this call.
artifacts/api-server typecheck:           Type '"CP-05-02-Crim" | "CP-05-02-Fam" | "CP-05-02-Juv"' is not assignable to type '"CP-05-02-Crim"'.
artifacts/api-server typecheck:             Type '"CP-05-02-Fam"' is not assignable to type '"CP-05-02-Crim"'.
artifacts/api-server typecheck: src/routes/discovery.ts(129,55): error TS2769: No overload matches this call.
artifacts/api-server typecheck: src/ujs/pilot.ts(52,68): error TS2769: No overload matches this call.
artifacts/api-server typecheck: Failed
```

The command exited 2. Complete actual output is in the session log
`/tmp/selectable-calendar-typecheck.log`. The stored discovery criteria type
still restricts the office to the old single office; this was not corrected
after the failed check.

```text
$ pnpm --filter @workspace/api-server run test:safety
> @workspace/api-server@0.0.0 test:safety /home/runner/workspace/artifacts/api-server
> node ./tests/run-safety.mjs

PASS: 487 offline checks; actual concurrent PostgreSQL grants; no court traffic or case fixtures.
FAIL: test_changed_asset_version_does_not_reuse_bootstrap_bytes (test_calendar_load_timeout.CalendarLoadTimeoutTests.test_changed_asset_version_does_not_reuse_bootstrap_bytes)
AssertionError: False is not true
FAIL: test_missing_result_grid_reports_honest_post_search_timeout (test_calendar_load_timeout.CalendarLoadTimeoutTests.test_missing_result_grid_reports_honest_post_search_timeout)
AssertionError: Lists differ: [] != ['BrowserTimeout']
FAIL: test_search_reaches_parser_without_repeated_asset_network_calls (test_calendar_load_timeout.CalendarLoadTimeoutTests.test_search_reaches_parser_without_repeated_asset_network_calls)
AssertionError: False is not true : Result parser must be reached

----------------------------------------------------------------------
Ran 66 tests in 90.605s

FAILED (failures=3)
```

The overall safety command exited 1. Each of the three loopback reproduction
observations recorded only the bootstrap GET and two asset GETs, no Search
POST, `parserReached: false`, `SUBMISSION_NOT_OBSERVED` and barrier
`CRITERIA_NOT_AVAILABLE_ON_SOURCE`; all recorded `shutdownErrors: []`.
Those are local fixture observations, not court responses. Complete actual
output is in `/tmp/selectable-calendar-safety.log`. No full-suite pass is claimed.

At that stop, the next step required user direction: correct the stored-type mismatch and
investigate the offline fixture/selection incompatibility without weakening
source validation, then rerun offline verification. Do not guess source
structure, authorize traffic or clear the source barrier.

**Prior v9 correction status:** the v9 timeout/cache regressions and full safety
suite now pass after the corrections recorded at the end of this document.
Full-project typechecking and the managed API build passed; API health is 200.
Earlier failures below are retained as actual before-fix evidence, not current
pass claims. Selectable search criteria and the later source/PDF milestones
remain separate unfinished work. No live execution is authorized by these
offline results.

## Infrastructure freeze

The parent HTTPS broker, inspection network sandbox/seccomp work and form
inspection v3 are paused. They guard a three-request inspection that is
switched off and is not needed for the requested search/PDF completion checks.
Do not expand that infrastructure or introduce new permit types.
`formInspectionLiveEnabled` remains false.

Only offline preparation is authorized here. Source-barrier clearing, each
live search and each PDF ladder step require separate exact-scope approval.
No historical permit or earlier success authorizes a new request.

## Previously completed office-label work

This checkout already contains the hyphenated office-name recognition fix and
filing inventory v8. Historical v7 has an explicit compatibility branch
retaining its five phases, `advancedSearch`, `county` and
`officeIdentification` validation. Historical v6 retains its own shape.
Historical methods are not accepted by the current worker validator.

The reported 48 live offices have not been independently verified here.
Offline form options are not docket/case records or source-access evidence.

## October 12 timeout hypothesis

The request timestamps in `docs/court-access-pilot-results.md` match the
attachment: Search returned HTTP 200 at 13:19:00.103 UTC, result CSS completed
at 13:20:09.604, and the job ended at 13:20:37.839. This is transport evidence,
not a validated result set or proof of court refusal.

The current implementation starts a 180-second full-load navigation wait
before the paced Search POST. Repeated result CSS/JS also pass through the
same 60–90 second completion-to-start pacing lock. A Playwright TimeoutError
is not on the worker's diagnostic allowlist and becomes UNEXPECTED_RESPONSE.
The parent's barrier handler calls validationStop(SOURCE_VALIDATION_BARRIER),
which clears access/collection approvals when first setting the stop.

The code path explains how an automatic barrier can be set. The historical
log and current code do not independently prove the absence of all manual
actions or establish which exception occurred on that historical run.
Offline reproduction is required before changing the timeout behavior.

## First attempt: stopped because the fixture did not reach Search

The first loopback fixture failed preflight. It did **not** reproduce the
October 12 failure and does not disprove the timeout hypothesis. No timeout,
cache, calendar method, UI or barrier behavior was changed. The new regression
test currently fails and the full safety suite must not be reported as passing.
Work stopped pending user direction to correct the fixture against the existing
form validator and rerun, without weakening that validator.

The fixture transport replaces Route.fetch with an ephemeral loopback HTTP
server before any source DNS/network request. The production pacing calculation
is retained with scaled clock inputs and shortened waits. The intended fixture
contains only public controls and a header-only table, never case records.

Commands run on October 16, 2026 and verbatim outcome excerpts:

```text
$ PYTHONPATH=artifacts/api-server/tests python -m unittest test_form_inspection.InspectionWorkerTests.test_public_office_codes_are_displayed_only_bounded_and_not_selected -v
test_public_office_codes_are_displayed_only_bounded_and_not_selected (test_form_inspection.InspectionWorkerTests.test_public_office_codes_are_displayed_only_bounded_and_not_selected) ... ok

----------------------------------------------------------------------
Ran 1 test in 1.695s

OK
```

```text
$ python -m unittest discover -s artifacts/api-server/tests -p 'test_calendar_load_timeout.py' -v
OFFLINE_REPRODUCTION {"network": [["GET", "/CaseSearch"], ["GET", "/resource/css/sitemain.min.css"], ["GET", "/resource/js/sitemain.min.js"]], "timeouts": [], "parserReached": false, "states": ["SUBMISSION_NOT_OBSERVED"], "barriers": ["CALENDAR_CONTROL_STATE_MISMATCH"]}
FAIL

======================================================================
FAIL: test_search_reaches_parser_without_repeated_asset_network_calls (test_calendar_load_timeout.CalendarLoadTimeoutTests.test_search_reaches_parser_without_repeated_asset_network_calls)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/nix/store/qzc04a3npl70cyyy6flnnrb2ig3kayxm-python3-3.13.11/lib/python3.13/asyncio/runners.py", line 118, in run
    return self._loop.run_until_complete(task)
           ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^^^^^^
  File "/nix/store/qzc04a3npl70cyyy6flnnrb2ig3kayxm-python3-3.13.11/lib/python3.13/asyncio/base_events.py", line 725, in run_until_complete
    return future.result()
           ~~~~~~~~~~~~~^^
  File "/home/runner/workspace/artifacts/api-server/tests/test_calendar_load_timeout.py", line 123, in test_search_reaches_parser_without_repeated_asset_network_calls
    self.assertTrue(parsed, "Result parser must be reached")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: [] is not true : Result parser must be reached

----------------------------------------------------------------------
Ran 1 test in 18.155s

FAILED (failures=1)
```

Complete command logs from this attempt are available in
`/tmp/office-label-check.log` and `/tmp/calendar-timeout-before.log`
for this workspace session. The reproduction excerpt omits only the verbose
asyncio scheduling diagnostic and repeats the actual failure, not the intended
timeout. No live request, barrier clearing or permit preparation occurred.

## Corrected fixture: timeout failure mode reproduced

The user approved: “Correct the fixture without weakening validation, then
rerun.”

The shared inspection fixture has a model input and a verification-token input
inside each unnamed widget. Calendar preflight correctly treats those multiple
backing-input candidates as ambiguous. The reproduction now uses a single
form-level verification token outside the widgets. Only this test fixture and
its redacted diagnostics changed; production form validation and worker behavior
remain unchanged.

The revised loopback run reached FORM_READY and completed the Search POST.
The repeated result stylesheet was fetched, but full-page navigation timed out
before the repeated script fetch and before CalendarResults.feed was called.
The worker emitted RESULTS_NOT_VALIDATED followed by UNEXPECTED_RESPONSE.
There were no form diagnostics. This reproduces the proposed failure mode,
not conclusive attribution of the historical October 12 exception.

This is the expected **red** result against the old implementation, not a
passing regression. The eventual passing expectation is that the result parser
is reached without duplicate asset network requests. The header-only fixture
must still be rejected as RESULTS_NOT_VALIDATED; it is not an empty-result
proof. Caching, result-wait changes, honest timeout mapping and calendar v9
have not yet been implemented.

Actual command and output excerpt (October 16, 2026):

```text
$ python -m unittest discover -s artifacts/api-server/tests -p 'test_calendar_load_timeout.py' -v
OFFLINE_REPRODUCTION {"network": [["GET", "/CaseSearch"], ["GET", "/resource/css/sitemain.min.css"], ["GET", "/resource/js/sitemain.min.js"], ["POST", "/CaseSearch"], ["GET", "/resource/css/sitemain.min.css"]], "timeouts": ["BrowserTimeout"], "parserReached": false, "states": ["FORM_READY", "RESULTS_NOT_VALIDATED"], "barriers": ["UNEXPECTED_RESPONSE"], "formDiagnostics": []}
FAIL

======================================================================
FAIL: test_search_reaches_parser_without_repeated_asset_network_calls (test_calendar_load_timeout.CalendarLoadTimeoutTests.test_search_reaches_parser_without_repeated_asset_network_calls)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/nix/store/qzc04a3npl70cyyy6flnnrb2ig3kayxm-python3-3.13.11/lib/python3.13/asyncio/runners.py", line 118, in run
    return self._loop.run_until_complete(task)
           ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^^^^^^
  File "/nix/store/qzc04a3npl70cyyy6flnnrb2ig3kayxm-python3-3.13.11/lib/python3.13/asyncio/base_events.py", line 725, in run_until_complete
    return future.result()
           ~~~~~~~~~~~~~^^
  File "/home/runner/workspace/artifacts/api-server/tests/test_calendar_load_timeout.py", line 131, in test_search_reaches_parser_without_repeated_asset_network_calls
    self.assertFalse(timeouts, "Full-load wait timed out before the result parser")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: ['BrowserTimeout'] is not false : Full-load wait timed out before the result parser

----------------------------------------------------------------------
Ran 1 test in 19.987s

FAILED (failures=1)
```

The full session log, including verbose asyncio scheduling diagnostics, is
`/tmp/calendar-timeout-corrected-fixture.log`. The process exited with status 1,
as expected before the production fix. No full-suite pass is claimed.
No court traffic, live permit, barrier change or deployment occurred.

## v9 implementation attempt: verification stopped on one failure

The user approved the offline cache/result-wait/v9 implementation. The working
tree now contains:

- Ephemeral bootstrap CSS/JS caching keyed by exact URL (including version query)
  and resource type. Cached responses do not acquire a request grant, invoke
  pacing or create network-accounting rows. They report separate counters.
  Cookies and transport framing are not replayed from cache.
- Navigation waits for commit rather than full load, then awaits the POST
  response and starts a separate 45-second result-grid deadline. No unobserved
  empty-result marker was invented.
- Post-Search Playwright timeout classification
  `CALENDAR_RESULT_LOAD_TIMEOUT`, on the explicit diagnostic allowlist.
- Integrated method `playwright-calendar+urllib-pdf-v9`. Historical diagnostic
  messages without new counters remain valid. Old v8 access proof cannot
  authorize v9. Stored report retrieval was not changed; a CLI report round-trip
  has not been exercised during this attempt.

**Not complete:** the first full safety run failed. Per the requested stop rule,
no further fix, build, API restart or live action followed that result.

The primary timeout regression passed: the parser was reached with four real
loopback network requests, four grants/accounts and two cached asset responses.
The header-only fixture still stopped as RESULTS_NOT_VALIDATED, not an invented
empty result. The missing-grid test passed with
CALENDAR_RESULT_LOAD_TIMEOUT.

The changed-asset-version test failed: its stylesheet was blocked before any
fifth loopback network request, and the worker reported
CALENDAR_REQUIRED_RESOURCE_BLOCKED. That test did not reach the parser.
No cause beyond the observed local blocking is established here. The test run
also emitted unhandled Playwright Response.finished teardown tasks ending in
`playwright._impl._errors.Error: Target closed`; those warnings remain unresolved.

Actual output excerpts:

```text
$ pnpm --filter @workspace/api-server run typecheck

> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> tsc -p tsconfig.json --noEmit
```

This command and the immediately chained `git diff --check` exited 0.

```text
$ pnpm --filter @workspace/api-server run test:safety

> @workspace/api-server@0.0.0 test:safety /home/runner/workspace/artifacts/api-server
> node ./tests/run-safety.mjs

PASS: 473 offline checks; actual concurrent PostgreSQL grants; no court traffic or case fixtures.

FAIL: test_changed_asset_version_does_not_reuse_bootstrap_bytes (test_calendar_load_timeout.CalendarLoadTimeoutTests.test_changed_asset_version_does_not_reuse_bootstrap_bytes)
AssertionError: False is not true

----------------------------------------------------------------------
Ran 65 tests in 91.523s

FAILED (failures=1)
/home/runner/workspace/artifacts/api-server:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @workspace/api-server@0.0.0 test:safety: `node ./tests/run-safety.mjs`
Exit status 1
```

Observed primary-regression counters and states, taken from the actual
OFFLINE_REPRODUCTION output:

```text
"network": [["GET", "/CaseSearch"], ["GET", "/resource/css/sitemain.min.css"], ["GET", "/resource/js/sitemain.min.js"], ["POST", "/CaseSearch"]]
"timeouts": []
"parserReached": true
"states": ["FORM_READY", "RESULTS_NOT_VALIDATED", "RESULTS_NOT_VALIDATED"]
"barriers": ["RESULTS_NOT_VALIDATED"]
"requestGrants": 4
"responseAccounts": 4
"networkRequests": 4
"cachedResponses": 2
```

The failed changed-version fixture instead reported:

```text
"timeouts": []
"parserReached": false
"states": ["FORM_READY", "RESULTS_NOT_VALIDATED"]
"barriers": ["CALENDAR_REQUIRED_RESOURCE_BLOCKED"]
"blockedStylesheets": 1
"consoleErrors": 1
"networkRequests": 4
"cachedResponses": 1
```

The complete session output, including all three fixture observations,
tracebacks and teardown warnings, is `/tmp/calendar-v9-safety.log`.
This is not a full-suite pass or live-readiness claim. Live inspection,
the source barrier, source approvals and the paused infrastructure remain
unchanged.

## Final offline correction and verification

The user approved diagnosing the blocked stylesheet and shutdown warnings,
then rerunning.

### Causes and corrections

- The changed-version fixture used `fixture_new`, an 11-character token.
  `allowed_asset_query` correctly requires 16–128 characters. The fixture now
  uses `fixture_new_version_0001` and asserts that its URL satisfies the
  unchanged source policy before launching Chromium. No request rule was
  broadened.
- Inspection of the pinned Playwright implementation confirmed that
  `Response.finished()` creates a target-close task but does not cancel it
  when response completion wins. The calendar helper now registers the public
  `requestfinished` event before Search, restricted to the main-frame POST to
  the fixed CaseSearch URL. It also verifies that the completed request belongs
  to the committed navigation response. The result-grid deadline starts after
  that completion; no full-page load wait was restored.
- The local fixtures fail if `Response.finished()` is called, capture and
  assert on unhandled shutdown exceptions, and still forward such exceptions
  to the normal loop handler rather than suppressing them.

### Observed regression results

All fixtures are loopback-only, with public form controls and a header-only
table; they are not real or synthetic case records. The header-only table
correctly remains unvalidated in every parser-reaching case.

| Fixture | Network requests | Cached asset responses | Parser reached | Expected final code | Shutdown errors |
| --- | ---: | ---: | --- | --- | --- |
| Identical bootstrap assets on results | 4 | 2 | Yes | RESULTS_NOT_VALIDATED | None |
| Missing result grid | 4 | 2 | No | CALENDAR_RESULT_LOAD_TIMEOUT | None |
| Changed stylesheet version | 5 | 1 | Yes | RESULTS_NOT_VALIDATED | None |

Each network request has one corresponding grant and response-accounting
message. Cache hits have neither. The ordinary regression's result deadline
is deliberately shorter than its paced pre-POST wait, demonstrating that the
result timer does not include that wait.

### Actual command output excerpts — October 16, 2026

```text
$ pnpm --filter @workspace/api-server run test:safety

> @workspace/api-server@0.0.0 test:safety /home/runner/workspace/artifacts/api-server
> node ./tests/run-safety.mjs

PASS: 473 offline checks; actual concurrent PostgreSQL grants; no court traffic or case fixtures.

----------------------------------------------------------------------
Ran 65 tests in 84.215s

OK
```

The command exited 0. Full output, including the three actual
OFFLINE_REPRODUCTION observations, is in the session log
`/tmp/calendar-v9-safety-fixed.log`. Every observation reports
`"shutdownErrors": []`; the complete output contains no `Target closed` or
`Task exception was never retrieved` messages.

```text
$ pnpm run typecheck

> workspace@0.0.0 typecheck /home/runner/workspace
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck

> workspace@0.0.0 typecheck:libs /home/runner/workspace
> tsc --build

Scope: 4 of 9 workspace projects
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/community-bail-research typecheck$ tsc -p tsconfig.json --noEmit
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck: Done
artifacts/api-server typecheck: Done
artifacts/community-bail-research typecheck: Done
artifacts/mockup-sandbox typecheck: Done
```

The full-project command and `git diff --check` exited 0. The typecheck
session log is `/tmp/calendar-v9-typecheck.log`.

Only the managed API workflow was restarted, once after these code changes.
Its actual build/start output included:

```text
> @workspace/api-server@0.0.0 dev /home/runner/workspace/artifacts/api-server
> export NODE_ENV=development && pnpm run build && pnpm run start

> @workspace/api-server@0.0.0 build /home/runner/workspace/artifacts/api-server
> node ./build.mjs

⚡ Done in 780ms

> @workspace/api-server@0.0.0 start /home/runner/workspace/artifacts/api-server
> node --enable-source-maps ./dist/index.mjs

[07:34:12.932] INFO (25500): Server listening
    port: 8080
```

The API health check through the development proxy returned:

```text
{"status":"ok"}
HTTP 200
```

This verifies the API build/start and health route, not a live source journey
or a full frontend build. No dependencies were changed or installed.

### Limits preserved

The inspector remains disabled. The broker, seccomp and sandbox infrastructure
was not changed. No court requests, source DNS lookups, live permits,
source-barrier clearing, collection approvals, deployments or invented records
were part of this correction. Passing these offline checks does not prove a
live result layout, an empty-result marker, court-client compatibility, the
reported live office count or deployed readiness.
