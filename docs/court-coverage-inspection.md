# Read-only discovery coverage inspection

## Status

The approved single-use inspection completed. The three-choice search engine is
**blocked, not complete**. No further source request is approved by this document or by accepting the
implementation task. The latest integrated calendar pilot failed after Search;
no validated results or PDF were obtained and its cause remains unresolved.
The existing source-wide validation stop must remain intact.

Offline scope prepared October 12, 2026:

- Permit: `2c0d340d-ecec-4f4e-af97-959f1516685d`, now `INSPECTED` and consumed.
- Legacy stored dates: October 14–20, 2026, never filled/submitted.
- Explicit user approval was recorded October 12, 2026. The bounded run started
  at 16:07:45 UTC and completed at 16:10:40 UTC.
- API typecheck/build and whitespace checks passed; 143 offline safety checks
  and 23 network-blocked Python protocol/browser tests passed. The API workflow
  restarted successfully and the unchanged public landing page rendered.

These checks prove the diagnostic's offline behavior, not portal support.

## Approved live findings — October 12, 2026

All three phases completed with three HTTP 200 GETs and no Search clicks,
transmitted POSTs, PDFs or docket records:

| Request | Duration | Since previous response completion |
| --- | --- | --- |
| `/CaseSearch` | 903 ms | — |
| `/resource/css/sitemain.min.css` | 194 ms | 86.455 seconds |
| `/resource/js/sitemain.min.js` | 195 ms | 67.260 seconds |

Persisted job: `f0b091ed-c2dc-452c-884f-1d58c2dff1dd`.
The operator report retains the closed, redacted INITIAL/CALENDAR/FILING
inventory; no page bodies or source option values were saved.

- Both a recognized public filing-date choice and a calendar choice were
  present and locally selectable.
- Under district 05 / CP-05-02-Crim, the public event list contained exactly
  recognized **Bail Hearing** and singular **Preliminary Arraignment** labels.
  The plural Preliminary Arraignments label was not observed.
- The scoped calendar office list contained CP-05-02-Crim, CP-05-02-Fam and
  CP-05-02-Juv. This is not evidence establishing MDJ office availability.
- Both enabled, visible filing date controls had a public minimum of
  1899-01-01 and maximum of 2026-10-12.
- Both enabled, visible calendar date controls had a public minimum of
  2026-10-12 and maximum of 2999-12-31.
- Filing mode disabled the inspected judicial-district selector. No scoped
  filing court-office codes could therefore be established by this inspector.
  Its absence is missing coverage evidence, not proof that MDJ is unsupported.

These are client-observed public form constraints, **not** successful submitted
searches, server acceptance of any date range, PDF access, or extraction proof.
The earlier post-Search failure remains unresolved. Subsequent read-only
database checks found no active source request, access-verification proof or
collection approval. The explicit source blocked-reason field was empty;
missing access proof still prevents collection, and does not erase the earlier
failure. The diagnostic does not authorize clearing that barrier.

The managed API workflow was restored and came up cleanly. No further court
request, retry or approval was performed.

Remaining evidence: filing-mode court/county controls and native submitted-field
bindings, MDJ criminal coverage, exact calendar event coverage, and fresh
separately approved submitted discovery/PDF/extraction proof for all three
advertised methods. Prepare any further diagnostic offline first; new court
traffic requires a new exact-scope approval.

## Fixed diagnostic scope

The operator-only `COVERAGE` stage uses
`playwright-coverage-inspection-v1`, the current integrated browser transport,
asset allowlist, persisted limiter and response classifier.

- At most three GETs total: `/CaseSearch`, `/resource/css/sitemain.min.css`,
  `/resource/js/sitemain.min.js`. Existing bounded `v` query rules apply.
- Zero Search clicks, transmitted POSTs, PDFs, docket rows or saved cases.
- Judicial district 05 (Allegheny) only. The calendar local preview selects
  exactly CP-05-02-Crim. The filing local preview selects only a uniquely
  source-listed filing-date mode identified by its public label; it does not
  invent a mode value, court office, input name or date range.
- Initial, calendar and filing observations retain bounded semantic flags,
  source-listed district-05 court-office codes and public date-input minimum/
  maximum constraints. Singular and plural Preliminary Arraignment labels are
  reported separately, not substituted.
- All native option values, source pages, field names, personal input values,
  hidden controls, tokens and cookies remain transient and are never recorded.
  Only a closed set of requested mode/event labels becomes boolean flags.
  Other search-mode labels are counted, never retained.
- Existing one-in-flight ownership, rolling budgets, 60–90-second
  response-completion pauses, adaptive waits and all stops apply. No retries,
  alternate client, extra assets, Search, date expansion or cap increase.
- After bootstrap, every further nonoptional request is aborted locally and
  fails the inspection, including any dependent-control fetch. Optional assets
  remain blocked under the existing policy.
- Roughly three minutes for the three bootstrap GETs, possibly longer due to
  shared pacing/quotas. A failure consumes the permit; unused slots do not
  authorize continuation.

## Interpretation limits

Presence of a public option is not successful server search or PDF access.
Absent or hidden options, unknown labels, unavailable dependent controls,
text-based date widgets or omitted constraints mean **missing evidence**, not
proof that a method is unsupported. Filing mode may expose a different county/
court selector; this inspector does not guess or populate it.

The scope metadata uses the legacy Common Pleas/Bail Hearing criteria and
record-cap-one schema placeholders. The actual document and POST allowances
are zero. Stored start/end dates are declared legacy scope placeholders,
**never filled or submitted to the court** by this stage. Calendar date bounds
do not establish historical filing-date support, and public date-input bounds
alone do not prove server date acceptance.

`INSPECTED` means the bounded inventory completed with three successful
accounted GETs and no collection. It is never `VERIFIED`, does not clear the
source-wide pause, and cannot enable collection or any subsequent verification.
Each of the three actual choices still needs its own adapter evidence and a
fresh approved discovery/PDF stage.

## Operator commands

Build first, then prepare offline:

```
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run pilot prepare --stage COVERAGE --start YYYY-MM-DD --end YYYY-MM-DD --requests 3
```

Preparation is not authorization. Obtain explicit approval of the above exact
diagnostic scope before recording approval or starting it. Only afterward use
the existing operator `approve` and `run` commands with that single prepared
permit. The managed API worker must be stopped for the approved run so the
runner can acquire its existing worker lease, then restarted after completion.
Approval expires after 24 hours; consumed, failed or stale permits are never
reused. No public approval or execution endpoint is added.

## Offline verification

The existing safety suite tests the new permit against the real PostgreSQL
limiter in an empty disposable schema. Network-blocked Playwright tests exercise
the actual worker with hypothetical **public form markup only**, not cases:
three GETs, no Search/PDF, all three inventory phases, unknown-label redaction
and durable failure on a dependent-control request. These checks are not
evidence of actual portal support.
