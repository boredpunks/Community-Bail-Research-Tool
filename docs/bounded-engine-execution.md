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

Both API and frontend builds/type checks passed. The latest full offline
regression run is being checked against the corrected code. No new live
permit has been prepared for the corrected method.

**Execution remains blocked on fresh user approval after this consumed failed
attempt.** A successful observation would allow continuation through fresh
search/document permits under the already-recorded engine authorization and
remaining overall budget, not another general conversational permission loop.
Calendar search and the end-to-end objective remain incomplete.
