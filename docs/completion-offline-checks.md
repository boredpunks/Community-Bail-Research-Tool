# Completion work: offline evidence and stop points

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

## Required stop: first reproduction did not reach Search

The first loopback fixture failed preflight. It did **not** reproduce the
October 12 failure and does not disprove the timeout hypothesis. No timeout,
cache, calendar method, UI or barrier behavior was changed. The new regression
test currently fails and the full safety suite must not be reported as passing.
Stop here pending user direction to correct the fixture against the existing
form validator and rerun; do not weaken that validator.

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
