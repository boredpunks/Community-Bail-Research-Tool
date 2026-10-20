# Calendar acceptance: implementation and verification

Date: October 19, 2026 (America/New_York).

## Tested checkout

- Branch: `fix/calendar-result-integration`.
- Base commit: `9745b3c2c61a139971dea6106c61dbece6a84b2b`.
- The implementation is **uncommitted working-tree code**, not that commit alone.
- Final API patch identifier: `a2c1174b15b09be66a1491b0d4cc9050d00d0f90249e63aa45562c8c99f3762c`.
  This SHA-256 covers the sorted paths and complete contents of the 12 changed/new
  API files below, with NUL separators. Documentation is outside this identifier.
- Fresh GitHub synchronization was not established. No reset, remote update,
  source-access clearance, production DDL, or publish was performed.

## Implemented changes

All paths in this table are relative to `artifacts/api-server/`.

| File | Purpose |
| --- | --- |
| `src/ujs/evidence.py` | Restrict links through the existing transport route/family allowlist; resolve allowed relative links; deduplicate identical resulting serialized actions within each row; preserve genuinely distinct actions as ambiguity. Attribute every existing malformed-state assignment and table-structure guard. Emit bounded version-2 diagnostics. |
| `src/ujs/calendar_structure.py` | Closed structural-reason vocabulary and numeric count vocabulary/bounds. |
| `src/ujs/calendar_dom.py` | Accumulate source-framing rejection reasons before browser HTML repair; identify fixed DOM-projection failures without retaining exception/source text. |
| `src/ujs/worker.py` | Carry framing reasons, projection failures, and observed/projected row disagreement into the existing diagnostic emission. Emission remains in `finally`, after validation/rejection. |
| `src/lib/calendar-layout.ts` | Strictly accept historical version 1 and current version 2; reject unknown fields/reasons, duplicate reasons, invalid or inconsistent counts. Rejected version-2 layouts cannot become empty-result proof. |
| `build.mjs` | Package the new Python vocabulary module; existing packaged worker import checks exercise it transitively. |
| `tests/test_calendar_acceptance.py` | Candidate-selection, ambiguity, identity, structural-branch, framing, count-bound, accumulation, and redaction regressions. Genuine supplied identifiers only; mechanical blank rows are not asserted to be case facts or saved. |
| `tests/calendar-layout.test.ts` | Historical/current contract acceptance and rejection, all reason codes, Python-to-TypeScript emission, and vocabulary parity. |
| `tests/test_calendar_load_timeout.py` | Real-worker loopback checks for framing, duplicate-grid projection, and row-count disagreement; guard the actual native document entry point against downloads. |
| `tests/test_calendar_response_size.py` | Update the stale serialization-variable check while explicitly preserving all-local-row projection and clone-only serialization assertions. |
| `tests/test_form_inspection.py` | Replace the obsolete removed-download mock with the native document entry-point mock and an explicit never-awaited assertion. |
| `tests/safety.ts` | Assert the already-existing native-session method, and explicitly reject approval for the retired urllib method. No transport implementation or access permission changed. |

Persistence, OpenAPI, generated clients, and UI did not require a schema or
display change: the existing event path validates and stores the sanitized JSON
message. Historical version-1 messages retain their original contract.
Code generation is not applicable to this internal versioned diagnostic change.

## Before/after evidence

Before the implementation, the new initial regressions reproduced:

- Relative/absolute aliases incorrectly producing malformed/ambiguous selection.
- Summary/search actions and wrong report families being eligible.
- No structural-reason or candidate-count projection.

After the repair:

- Identical relative anchors and relative/absolute aliases select one sheet.
- A sheet plus summary/search actions selects only the sheet.
- Wrong families, identity mismatches, unsupported routes, and unsafe queries stay
  ineligible.
- Different opaque `dnh` values stay distinct and ambiguous. Their original
  serialization is preserved; parameters are not removed or reordered.
- Existing malformed/incomplete, date, identity/scope, and explicit-empty
  protections remain in force.

## Diagnostic definitions

Counts are calculated **within each observed data row**. Top-level counts sum
those row counts; they are not distinct-docket counts or global URL cardinalities.
The separate response diagnostic still reports validated rows/distinct dockets.

| Count | Definition |
| --- | --- |
| `rawAnchorOccurrences` | Every anchor occurrence encountered in the row, including repetitions. |
| `uniqueRepresentations` | Distinct nonempty source href strings encountered in that row, before resolution/eligibility filtering. |
| `eligibleRepresentations` | Distinct href representations that satisfy supported-sheet, exact identity, and report-family rules. |
| `uniqueEligibleActions` | Distinct resulting absolute serialized eligible URLs after permitted relative resolution. |

Example: two identical relative anchors, their identical absolute alias, and one
summary produce counts **4 / 3 / 2 / 1**, respectively.
`recognizedDocumentLinks` now counts unique eligible actions per row, summed.

Counts are capped at 10,000 with overflow reported. At most eight row
observations are emitted, with omission reported. Reasons form a unique,
accumulating set from the following closed vocabulary:

```text
NESTED_TABLE
ROW_OPENED_BEFORE_CLOSE
CELL_OPENED_BEFORE_CLOSE
INVALID_CELL_SPAN
CELL_CLOSE_MISMATCH
ROW_CLOSED_WITH_OPEN_CELL
HEADER_CELL_SPAN
COMPETING_DOCUMENT_ACTIONS
DATA_CELL_SPAN
MIXED_CELL_TYPES
TABLE_CLOSED_WITH_OPEN_CONTENT
RESULT_TABLE_MISSING
RESULT_TABLE_COUNT
HEADER_ROW_COUNT
UNCLOSED_RESULT_CONTENT
UNSUPPORTED_EVENT_HEADERS
ROW_TOO_SHORT
DOCUMENT_ACTION_MISSING
CASE_INFORMATION_ROW_WIDTH
CASE_INFORMATION_EVENT_DATE_MISSING
CELL_OUTSIDE_ROW
ROW_CLOSE_WITHOUT_OPEN_ROW
SOURCE_FRAMING_REJECTED
SOURCE_ENCODING_UNSUPPORTED
SOURCE_DECODING_FAILED
SOURCE_TOKEN_LIMIT
SOURCE_STRUCTURE_MISMATCH
EVENT_DATE_LAYOUT_UNSUPPORTED
DOM_PROJECTION_LIMIT
```

No raw hrefs, opaque query values, case text, or exception messages are added to
diagnostics. The tests check both safe Python emission and parent acceptance.

## One verification ledger

Revision labels:

- **Base**: the commit above, plus only the new initial regression file.
- **Implementation**: that commit plus the evolving Batch 1 working tree; failures
  below describe what remained at that point.
- **Final**: that commit plus the API patch identifier above. Later documentation
  changes do not change the tested application code.

The final build and focused Python check preceded the last test-only correction
to the retired-method assertion; their application code is unchanged. The
complete final safety command tests the full patch identifier.

| Command/check | Revision tested | Outcome | Relevant failure or evidence |
| --- | --- | --- | --- |
| `python -m unittest discover -s artifacts/api-server/tests -p test_calendar_acceptance.py -v` (before repair) | Base | Exit 1 | 11 tests; 7 failures and 14 subtest/errors. Reproduced selection defects and absent diagnostic fields; did not establish the historical live cause. |
| `python -m unittest discover -s artifacts/api-server/tests -p 'test_calendar_*.py' -v` | Implementation | Exit 1 | 105 tests; one stale `table.outerHTML` assertion and 25 obsolete `worker.download` mock errors. Candidate/contract regressions passed. |
| `pnpm run typecheck` | Implementation | Exit 0 | Shared libraries, API, frontend, sandbox, and scripts. Repeated as part of final production build. |
| `cd artifacts/api-server && node --input-type=module -e 'import {build} from "esbuild"; await build({entryPoints:["tests/calendar-layout.test.ts"],outfile:"/tmp/bail-calendar-layout-check.mjs",bundle:true,platform:"node",format:"esm"});' && node /tmp/bail-calendar-layout-check.mjs` | Implementation | Exit 0 | Version-1/version-2 contract and actual Python-emission compatibility; also covered in final safety command. |
| `pnpm --filter @workspace/api-server run test:safety` (first full attempt) | Implementation | Exit 1 | 188 Python tests; two failures, 47 errors, five skips. Removed-download mock also existed in shared form fixtures; new truncation test expected the wrong specific code. TypeScript also stopped at a stale retired-method assertion. |
| `pnpm --filter @workspace/api-server run test:completion` | Implementation, before final DOM attribution | Exit 0 | Genuine CP PDF extraction, monetary/date contracts, saving/review/readback in a rolled-back transaction, legacy compatibility, session validation. Later edits only added structural attribution and corrected test expectations; this check's affected code is unchanged. |
| `pnpm --filter @workspace/api-server run test:research-workflow` | Implementation, before final DOM attribution | Exit 0 | Operation isolation, origin/PDF boundaries, pacing/backoff/waits, optional criteria, inclusive/posted filters. Affected code unchanged afterward; this suite is also imported by final safety. |
| `pnpm --filter @workspace/bail-research test` | Implementation, before final DOM attribution | Exit 0 | Five projection tests, including displayed-row CSV and event/observation handling. Library code unchanged afterward. |
| `PORT=5173 BASE_PATH=/ pnpm run build` | Final | Exit 0 | All typechecks/builds and packaged Python imports. Existing nonfatal frontend sourcemap warnings remain. |
| `python -m unittest discover -s artifacts/api-server/tests -p test_calendar_acceptance.py -v` (after repair) | Final | Exit 0 | All 15 focused tests passed, including branch subcases and count/redaction bounds. |
| `pnpm --filter @workspace/api-server run test:safety` (second full attempt) | Final, except last test expectation | Exit 1 | All 191 Python tests passed with five skips; parent accepted 26 actual-worker diagnostics. TypeScript stopped at the obsolete v14 method expectation, since corrected without relaxing the current-method access gate. |
| Bundled `tests/safety.ts` command below | Final | Exit 0 | All 953 offline TypeScript checks, including concurrent PostgreSQL grants. |
| `pnpm --filter @workspace/api-server run test:safety` (final complete command) | Final | Exit 0 | 953 TypeScript checks; 191 Python tests in 222.471 seconds, five explicit skips; parent accepted 26 actual-worker diagnostics with redaction checked. |
| `git diff --check` | Final code and documentation | Exit 0 | Whitespace check passed. |
| Managed API restart and workflow logs | Final | Running | API built/imported successfully and is listening; no startup crash. |
| `curl -fsS "https://$REPLIT_DEV_DOMAIN/api/healthz"` | Final development service | Exit 0 | `{"status":"ok"}`. |
| `curl -sS -o /dev/null -w '%{http_code}\n' "https://$REPLIT_DEV_DOMAIN/api/discovery/jobs"` | Final development service | Exit 0; HTTP 401 | Unauthenticated protected readback stays protected. Not signed-in acceptance. |
| Development preview screenshot, `/` | Final development app | Captured | Public landing page renders; no browser errors in capture. Does not establish authenticated or published readiness. |
| Retained-job diagnostic queries | Historical persisted version 1 | Queries succeeded | Complete transport, matching intercepted criteria, one table, 19 headers, 38 rows, 76 old candidates; malformed=true. No reason codes or unique-action counts. |
| Live calendar acceptance | Final | Not run; authorization gate | Requires one narrowly approved calendar-only observation. |
| Live native-session documents | Final | Not run; separate gate | Offline native-context/cookie/referrer/download and denial/redirect checks are in the Python suite. No current-method live-readiness claim. |
| Published revision, schema, signed-in results/evidence/CSV | Not tested | Blocked/separate gate | User publishing and supported schema review required first. |

Exact standalone TypeScript safety command:

```sh
cd artifacts/api-server &&
node --input-type=module -e 'import {build} from "esbuild"; await build({entryPoints:["tests/safety.ts"],outfile:"/tmp/bail-final-safety-ts.mjs",bundle:true,platform:"node",format:"esm",external:["pg-native"],sourcemap:"inline",banner:{js:"import { createRequire } from \"node:module\"; const require = createRequire(import.meta.url);"},logLevel:"warning"});' &&
node --enable-source-maps /tmp/bail-final-safety-ts.mjs
```

The five Python skips are explicit limitations, not passes: four historical
source-PDF regressions remain unavailable after the retained HTTP 401, and one
optional additional local MDJ sample is absent. The three actual supplied CP/MDJ
PDF fixtures are available and exercised separately by `test_supplied_bail.py`;
the supplied CP PDF also exercises native-session loopback download/extraction.
No skipped source document was fabricated or fetched to make tests pass.

## Historical uncertainty and next gates

The retained report does **not** establish the malformed branch. Its raw anchor
counts cannot distinguish duplicate representations, excluded summaries, or
genuinely different opaque actions. The independently reproduced alias defect
is repaired, but this is not proof that the historical 38-row failure is fixed.

Smallest additional evidence: one fresh, separately authorized calendar-only
observation using the retained exact scope:

- October 20, 2026 only.
- Office `CP-05-02-Crim`; all rooms; `Formal Arraignment`.
- Existing request cap 12 and record cap 5; one Search submission.
- Capture the version-2 reason set and row candidate-count projection together
  with transport, criteria, structure, validation, and terminal-state evidence.
- Stop after calendar validation/diagnostics. No PDF retrieval, inferred links,
  method substitution, date change, or clearance of retained denials.

After calendar acceptance, live native-session document assessment and
collection approval remain separate. A saved checkpoint is not a reusable
browser session. The prior 401 was from the separate no-cookie constructed MDJ
request, not proof about the native-session method.

Release status is separate again: the previously verified
`RECORDED_BAIL_AMOUNT` development/production enum difference is still a release
dependency; no full schema diff or published readiness is claimed here. User
publishing, actual released-revision identification, and signed-in verification
remain outstanding. The assigned end-to-end task is not marked complete.
