# Section 10 — Phase 2 report

Scope: amended offline-only work order. No court requests, probe reruns,
preparation/approval/run commands, source clearing, resume, Phase 3, production
DDL or publication. MET below refers only to the amended Phase 2 requirement;
it does not mean live acceptance.

Branch: `fix/public-http-document-step`, created at
`3d0cca2fee706316e92589dee61f758765da348a`.

Initial implementation commit:
`8cb87a6111f1d4c49091f15f393afbfd5d33389f`.
Current-run capture correction commit:
`e3979636437a8d750d5ed8aa1ba70f6709075e3c`.
Initial proposal/evidence commit:
`f800f55108cf3f5f1df2343fdc0209a4dd86c9bb`.
The initial report was recorded in `35e01b1`. A later packaging commit,
`4c67f9b`, is also on this branch and (as the owner noted) on `origin`; it
commits the two probe scripts, the original work order, the three owner-supplied
attached notes and agent asset metadata. The earlier statement that those files
were not committed was wrong. All corrections are additive; no history was
rewritten.

Baseline tests ran on the clean exact-base worktree, with installed dependency
links and local genuine PDFs available. The original post-change comparison
used the implementation committed as 8cb87a6. During that verification,
documentation changed but application and test code did not. A later additive
commit, e397963, added the current-run calendar-capture stop and regression test;
the latest complete rerun against that revision is recorded in Section 2.
The preview checkout is on the requested branch. The original
`fix/calendar-result-integration` branch was not advanced.

## Requirements

### R-0: NOT MET
Evidence: Phase 0 was previously accepted with amended exclusions. Current
read-only checks returned historical job PAUSED, calendarComplete=true,
requestsUsed=5, 38 items (37 UNPROCESSED, 1 RETRIEVAL_FAILED). Source remains
ACCESS_DENIED, proof/method/collection approval null, no active request.
Development and production enum labels and meaningful host fingerprints were
compared before development DDL; see the database section below.
The scheduler, grant interface and excluded assess-download command were not
modified.

Not verified: R-0.11's published SHA remains unknown. Phase 0 is not presented
as a newly executed live assessment; the excluded assessment/cancellation
defect was not repaired or exercised.

### R-1: MET
Evidence: owner-supplied successful Probe 2 evidence retained, not rerun:
form GET 200 / 2,605,160 bytes; calendar POST 200 / 3,716,735 bytes /
1,002 links / 431 distinct CP dockets; cookie-/Referer-free PDF GET 200 /
application/pdf / 76,602 bytes / `%PDF-`.

Not verified: this is supplied evidence, not output of a new command in
Phase 2. It does not prove this app's downloader receives a Playwright-captured
action, current source access, or an opaque action's lifetime.

### R-2: MET
Evidence: `artifacts/api-server/src/lib/discovery-safety.ts:5` now specifies
`playwright-calendar+public-http-pdf-v16`. The latest run printed
`PASS: 986 offline checks; actual concurrent PostgreSQL grants; no court traffic or case fixtures.`
and passed the 33 strict response checks. The combined `run-safety.mjs` command
exited 1 because its embedded Python suite had 2 failures and 2 errors; see
Section 2 for exact rerun results. Method comparisons remain exact, with no v15
compatibility path.

Not verified: no v16 live proof was established; old proof was not relabeled.

### R-3: MET
Evidence: `src/ujs/worker.py:1031–1035` calls public_http.download with the exact
item sourceUrl inside the existing retrieve/grant path.
`test_public_http.NormalWorkerDocumentTests.test_parent_grant_precedes_exact_public_download_extraction_and_disposal`
passed. It asserts grant consumption precedes the exact downloader call.

Not verified: the worker test uses a supplied PDF and a mocked downloader,
not a court request. The separate loopback matrix exercises the real downloader.

### R-4: MET
Evidence: no CalendarDocument import, instantiation, browser-document route
hook or open call remains in normal worker.py. The module and all historical
tests remain, with the requested superseded-v15 module label.
The normal-worker tests reject any attempt to instantiate the v15 object.
The worker also stops with `document_session_required` if pending document
items exist but this process has no `calendar_links_captured_at` timestamp.
The offline regression asserts no request, response, docket or downloader call
in that condition; the existing parent pauses the job on this event. The
specific regression passed in the full Python run.

Not verified: historical v15 tests are not evidence for live v16 access.

### R-5: MET
Evidence: real downloader tests assert `%PDF-`, bounded bytes, identity
mismatch with no entries, SHA-256 and documentPageCount; the three genuine
fixtures retain the requested amount/page/posting outcomes.
Parent provenance validation and documentLocations remain on the extraction
path. Normal-worker success and denial tests assert response disposal.

Not verified: no new live PDF, persisted live SHA, or current portal match.

### R-6: MET
Evidence: no diff from base in discovery-scheduler.ts, discovery.ts policy
defaults, research-pacing.ts or assess-download.ts; grant() signature/body
unchanged. The request event and parent permission are still required before
fetch. `test_refused_grant_never_calls_downloader` passed.

Not verified: no live pacing measurement. Existing environment overrides
200 records/500 requests were discovered and disclosed, not edited; they are
not approval for larger runs. Default code limits remain 5, 30/hour, 120/day.

### R-7: MET
Evidence: source_protocol.classify_response and public_http.py are unchanged.
Named loopback assertions cover 401/403, 429, 302, other errors, challenge,
wrong signature and size overflow, one request per attempt and zero retries.

Not verified: future portal behavior; no refusal was provoked live.

### R-8: MET
Evidence: `src/ujs/document_diagnostics.py` bounds and sanitizes refusal
evidence; `src/lib/document-response.ts` is a closed parent contract rejecting
unknown top-level, evidence and header keys. Parent accounting is followed by
events using the persisted request's durationMs; existing job-event rendering
is unchanged. The strict tests printed:
`PASS: 33 strict document-response, actual Python redaction, denial propagation and request-timing checks.`
Worker denial tests also passed.

Not verified: no actual court refusal was received. Redaction is deliberately
conservative: only recognized refusal phrases are copied; arbitrary prose,
names, realms and unrecognized header values are omitted/redacted. That can
lose diagnostic detail but avoids asserting that regex alone removes names.
Resumed old actions report null capture age, not a fabricated timestamp.

### R-9: MET
Evidence: all required loopback cases are individually named in
`tests/test_public_http.py`: three genuine fixtures; identity mismatch;
401 evidence; 429/Retry-After; no-follow 302; challenge; 4 MB overflow; invalid
PDF; independently rejected path/host/query/docket; exact UA/no credentials;
one request/no retry; byte-identical encoded opaque action.
The real allowlist is not relaxed: only the test TCP connector is replaced by
an explicit 127.0.0.1 connector, preserving the original request target. The
latest direct Python rerun is not all-green: 218 tests, 6 failures, 4 errors and
5 skips, exit 1. The safety entry point's embedded Python rerun also had
failures and errors. Exact results and test names are in Section 2.

Not verified: five existing real-PDF tests remain skipped because their
specific local source files are unavailable. No files were fetched to fill
those gaps.

### R-10: MET
Evidence: written-only `docs/public-http-owner-approval-proposal.md` identifies
the minimum missing behavior: the explicit existing approve command records
one permit's ID, office, event type, date window and method ID in the job event
log. No approval or auth mechanism was coded.

Not verified: no approval event was written. Approval alone must not clear
ACCESS_DENIED; the existing successful-pilot proof path is separate.

### R-11: NOT RUN
Evidence: no fresh calendar or live job was started; source ledger unchanged.

Not verified: A1 or any current/future source calendar validation.

### R-12: MET
Evidence: amended replacement Step B is written only in
`docs/public-http-step-b-proposal.md`. It cites SINGLE admission under retained
denial, full criteria and exact prepare/approve/run templates, guards, budgets,
Eastern-date rules, all proof predicates and throughput. It explicitly states:
“A document request slower than 20 seconds fails pilot verification by design.”
Exactly 20 seconds fails as well because the predicate is `< 20_000`.

Not verified: no template was executed. Owner approval/audit is missing.
The verifier's single spacing threshold can reject a scheduler-lawful fast
asset gap; no guard was changed. Approval alone does not clear ACCESS_DENIED:
the existing successful-run logic clears later. A7 requires that clarification.

### R-13: NOT RUN
Evidence: no batch or document collection run.

Not verified: live batch extraction, outcome distribution or source-stop
behavior. A future five-document batch needs separate approval; neither the
old ten-document work-order suggestion nor pre-existing env overrides grant it.

### R-14: MET
Evidence: no 50-, 100- or 200-document run, approval or limit change.

Not verified: throughput forecasts are arithmetic, not measured collection.

### R-15: MET
Evidence: geometry-only tests assert Denied/Nonmonetary/Recognizance $0.00 rows
produce null amount/basis while retaining the exact row and page. Shared tests
exclude them from monetary qualification/projection/CSV. The persistence
boundary nulls such structured financial fields while preserving evidence;
the UI labels these entries “No monetary bail recorded” before formatting any
numeric value. The six named monetary tests passed.

Not verified: no new live denied docket, rendered authenticated docket row,
or owner portal comparison. No genuine historical data was rewritten.

## Whole-task live acceptance

| Item | Status | Evidence / not verified |
|---|---|---|
| A1 | NOT RUN | No fresh live calendar search. |
| A2 | NOT RUN | No app-to-court PDF GET or live capture-to-GET age. |
| A3 | NOT RUN | Offline signature/identity/hash checks do not establish a live stored SHA. |
| A4 | NOT RUN | Genuine local fixtures are not a fresh live extraction. |
| A5 | NOT RUN | No live authenticated screen/CSV comparison. |
| A6 | NOT RUN | The owner has not independently confirmed the same new docket on the portal. |
| A7 | NOT RUN | No live reconciliation or owner-approved clear; retained denial is unchanged. |

The exact discovery-card disclaimer is unchanged. Offline projection/CSV
tests do not satisfy A5.

## 1. Files changed

Paths below are relative to the repository root and describe Phase 2's
implementation/report changes. `artifacts/api-server/src/lib/discovery-candidates.ts`
was part of the implementation but was omitted from the first list; this is
corrected here. The branch separately includes the five owner-supplied files
and metadata committed by 4c67f9b, listed above; they were not authored or
modified by the Phase 2 implementation. No history was rewritten.

| Path | Reason |
|---|---|
| artifacts/api-server/src/lib/discovery-safety.ts | v16 integrated method only. |
| artifacts/api-server/src/ujs/worker.py | Public HTTP document call; remove live popup path; require a calendar-link capture in this run; bounded evidence and capture timing. |
| artifacts/api-server/src/lib/discovery-candidates.ts | Apply nonmonetary amount normalization at the candidate persistence boundary. |
| artifacts/api-server/src/ujs/calendar_document.py | Historical-v15 label, module retained. |
| artifacts/api-server/src/ujs/document_diagnostics.py | Conservative bounded refusal evidence and elapsed-time helper. |
| artifacts/api-server/src/lib/document-response.ts | Strict response validator and safe event projection. |
| artifacts/api-server/src/lib/discovery-worker.ts | Validate response, account unchanged scheduler path, publish safe duration/denial events. |
| artifacts/api-server/build.mjs | Include the new Python helper in the packaged worker. |
| artifacts/api-server/tests/test_public_http.py | Real loopback downloader matrix, diagnostics, grant/disposal and stale-link stop regression. |
| artifacts/api-server/tests/document-response.test.ts | Closed contract, real Python output, timing/denial projection checks. |
| artifacts/api-server/tests/safety.ts | Import/count new checks and update exact method assertion. |
| artifacts/api-server/tests/test_calendar_load_timeout.py | Re-point refusal mock to worker.public_http.download; same “No PDFs” exception and assert_not_awaited. |
| artifacts/api-server/tests/test_form_inspection.py | Re-point refusal mock to worker.public_http.download; same “PDFs prohibited” exception and assert_not_awaited. |
| artifacts/api-server/tests/test_supplied_bail.py | Geometry-only nonmonetary-zero evidence regression. |
| artifacts/api-server/tests/completion.ts | Separate actual-table SELECT for $100/10%/page 1 and post-rollback absence check. |
| artifacts/community-bail-research/src/pages/discovery.tsx | Label nonmonetary categories before numeric formatting. |
| lib/bail-research/src/index.ts | Preserve quotes/pages but null nonmonetary structured amount/basis on save. |
| lib/bail-research/tests/monetary.test.ts | Nonmonetary zero never qualifies or exports as monetary. |
| lib/db/migrations/20261021_recorded_bail_amount.sql | Idempotent additive development SQL artifact. |
| docs/public-http-enum-development.md | Separation, inventory, actual operation, readback and rollback boundaries. |
| docs/public-http-step-b-proposal.md | Unexecuted SINGLE proposal, timing predicates and throughput. |
| docs/public-http-owner-approval-proposal.md | Written-only specific-permit scope and method approval-event requirement; no per-person authentication. |
| docs/public-http-calendar-v17-note.md | Conditional one-page v17 design only; no fallback implemented. |
| docs/public-http-phase-two-report.md | This section 10 report. |
| .agents/memory/MEMORY.md | Index the non-obvious database identity lesson. |
| .agents/memory/database-separation.md | Record why a null server IP must not become an “unknown” host fingerprint. |

Both specifically requested mock edits retain the original refusal assertion;
neither test was deleted, skipped or weakened.

## 2. Exact commands and results

Historical commands ran from `/tmp/bail-public-http-phase2` unless a different
directory is shown. The latest e397963 rerun ran from the current workspace at
`/home/runner/workspace`. The preview checkout was switched only after the
implementation and proposal commits, with the owner's five later-added files
restored byte-for-byte as untracked files, not staged.

### Historical baseline versus the initial implementation run

The right-hand column records the earlier run on 8cb87a6, not the latest
verification. The full rerun on e397963 follows this historical comparison.

| Command / working directory | Baseline at 3d0cca2 | Initial post-change run on 8cb87a6 |
|---|---|---|
| `cd artifacts/api-server && python -m unittest discover -v -s tests -p 'test_*.py'` | 191 total: 184 pass / 2 fail / 5 skip; exit 1 | 217 total: 212 pass / 0 fail / 5 skip; exit 0 |
| `cd artifacts/api-server && node tests/run-safety.mjs` | 953 counted TS checks passed; script exit 0 | 986 counted TS checks passed; script exit 0 |
| Python discover invoked internally by run-safety.mjs | 191 total: 186 pass / 0 fail / 5 skip | 217 total: 212 pass / 0 fail / 5 skip |
| `cd artifacts/api-server && node tests/run-completion.mjs` | 1 script pass / 0 fail / 0 skip; exit 0 | 1 script pass / 0 fail / 0 skip; exit 0 |
| `cd artifacts/api-server && node tests/run-research-workflow.mjs` | 1 script pass / 0 fail / 0 skip; exit 0 | 1 script pass / 0 fail / 0 skip; exit 0 |
| `pnpm --filter @workspace/community-bail-research run test:discovery-retention` | 1 script pass / 0 fail / 0 skip; exit 0 | 1 script pass / 0 fail / 0 skip; exit 0 |
| `pnpm --filter @workspace/community-bail-research run test:calendar-preview` | 1 script pass / 0 fail / 0 skip; exit 0 | 1 script pass / 0 fail / 0 skip; exit 0 |
| `pnpm --filter @workspace/bail-research test` | 5 named tests pass / 0 fail / 0 skip; exit 0 | 6 named tests pass / 0 fail / 0 skip; exit 0 |

In that historical 8cb87a6 comparison, all six TypeScript entry points passed.
The latest rerun invoked the same six: five exited 0; `run-safety.mjs` printed
986 passing offline checks but exited 1 because its embedded Python suite
reported failures and errors. The monetary native-test entry is one of the six.
Do not add entry points, safety check counters and native tests into a
fictional single “unique test” count.

All TypeScript test-file inventory is covered: bounded-launch, calendar-layout,
document-locations, job-criteria and new document-response through safety;
inspection-broker checks through safety; completion and research-workflow
through their scripts; calendar-preview/discovery-retention through web scripts;
monetary through its native test runner.

**Duplicate execution:** run-safety invokes the full Python suite, not extra
unique coverage. The latest run therefore executed Python once directly and
once inside run-safety; those outcomes are reported separately below, not
summed. research-workflow is also imported by safety and separately run by its
script. Baseline Python and run-safety were concurrent; the latest runs were
sequential.

### Latest complete rerun on e397963

All commands ran sequentially on `e3979636437a8d750d5ed8aa1ba70f6709075e3c`.
No source request, probe, approval, job run, source clear, resume, Phase 3,
deployment, or production operation occurred.

| Command | Result |
|---|---|
| `cd artifacts/api-server && python -m unittest discover -v -s tests -p 'test_*.py'` | 218 tests in 706.853s: 203 pass, 6 fail, 4 errors, 5 skipped; exit 1. |
| `cd artifacts/api-server && node tests/run-safety.mjs` | 986 offline checks passed; 33 strict document-response checks passed; parent accepted 25 actual-worker diagnostics. Its embedded Python run: 218 tests in 712.038s, 209 pass, 2 fail, 2 errors, 5 skipped. Composite exit 1. |
| `cd artifacts/api-server && node tests/run-completion.mjs` | Pass; exit 0. |
| `cd artifacts/api-server && node tests/run-research-workflow.mjs` | Pass; exit 0. |
| `pnpm --filter @workspace/community-bail-research run test:discovery-retention` | Pass; exit 0. |
| `pnpm --filter @workspace/community-bail-research run test:calendar-preview` | Pass; exit 0. |
| `pnpm --filter @workspace/bail-research test` | 6 pass, 0 fail, 0 skipped; exit 0. |

The new current-run capture regression
`test_pending_item_without_current_run_calendar_capture_stops_before_source_request`
passed in the direct full Python run.

Failures and errors observed in the direct Python run:

- **Failures (6):** `test_case_information_headers_flow_through_production_diagnostics_and_parser`;
  `test_changed_asset_version_does_not_reuse_bootstrap_bytes`;
  `test_large_malformed_grid_is_not_repaired_into_acceptance`;
  `test_large_response_validates_explicit_empty_early_and_late`;
  `test_missing_result_grid_reports_honest_post_search_timeout`;
  `test_no_room_scope_never_silently_uses_source_selected_room`.
- **Errors (4):** `test_before_post_error_is_not_reported_as_after_response_and_prevents_transmission`;
  `test_console_stop_aborts_new_browser_data_requests_without_another_grant`;
  `test_large_warning_preserves_incomplete_coverage`;
  `test_malformed_result_header_has_safe_parser_and_structure_outcomes`.

Failures and errors in run-safety's embedded Python rerun:

- **Failures (2):** `test_large_malformed_grid_is_not_repaired_into_acceptance`;
  `test_large_response_validates_explicit_empty_early_and_late`.
- **Errors (2):** `test_large_warning_preserves_incomplete_coverage`;
  `test_new_limit_exceeded_is_unvalidated_not_truncated_success`.

No test was disabled, skipped by code change, or weakened to produce these
results. The runs do not establish a cause for the observed calendar
form/response timeout failures.

### Historical 8cb87a6 comparison: tests whose result differed

1. `test_calendar_load_timeout.CalendarLoadTimeoutTests.test_large_response_validates_explicit_empty_early_and_late`:
   baseline FAIL (`CALENDAR_RESULT_LOAD_TIMEOUT` instead of no barriers);
   post-change PASS.
2. `test_calendar_response_size.BrowserStreamTests.test_denials_challenges_and_redirects_never_become_results`:
   baseline FAIL in status=200/CHALLENGE subcase (`NETWORK_ERROR` instead of
   CHALLENGE); post-change PASS.

Both passed in the earlier untouched-base Python rerun inside run-safety. This
historical comparison does not override the later e397963 results above. No
claim is made that v16 corrected those baseline failures; their assertions and
calendar implementation were not weakened. There are 27 new Python tests on
the current branch (26 in the initial implementation plus the capture-stop
regression) and one additional native monetary test. The imported TypeScript
response checks contribute 33 to the safety assertion count.

### Unchanged skipped tests

- `test_real_document_regressions.RealDocumentRegressionTests.test_real_source_document_1`
- `test_real_document_regressions.RealDocumentRegressionTests.test_real_source_document_2`
- `test_real_document_regressions.RealDocumentRegressionTests.test_real_source_document_3`
- `test_real_document_regressions.RealDocumentRegressionTests.test_real_source_document_4`

These print: `Real source PDF not retrieved; integrated client stopped on HTTP 401.`

- `test_uploaded_mdj.UploadedMdjTests.test_real_header_mapped_entries_and_posting`

This prints: `Additional real PDF must be supplied locally; never commit personal records`.
The available three supplied CP/MDJ fixtures were run, not skipped.

### Additional development checks

- `cd artifacts/api-server && python -m unittest discover -v -s tests -p test_public_http.py`:
  initial 22/0/0 pass/fail/skip, exit 0; after adding worker integration tests,
  25/0/0, exit 0. These are included again in the full suite, not unique extras.
- `cd artifacts/api-server && node -e 'import("esbuild").then(e=>e.build({entryPoints:["tests/document-response.test.ts"],outfile:"/tmp/document-response-check.mjs",bundle:true,platform:"node",format:"esm"}))' && node /tmp/document-response-check.mjs`:
  printed 33 passing strict response checks, exit 0; duplicated later in safety.
- `pnpm run typecheck`: exit 0 in both targeted development checks. The final
  one covered all implementation code. The full build also invokes typecheck.
- `PORT=5173 BASE_PATH=/ pnpm run build`: exit 0, including affected API Python
  packaging/import smoke and web production bundle. Non-fatal Vite sourcemap
  location warnings appeared; they did not turn the build into a failure.
- `git diff --check` and staged whitespace checks: exit 0.
- Managed API/web workflows restarted once after switching the preview
  checkout. Startup logs show the server listening; no queued/running source
  jobs or active requests existed before restart.
- `curl -sS -o /tmp/bail-health.json -w 'API_HEALTH_HTTP=%{http_code}\n' "https://${REPLIT_DEV_DOMAIN}/api/healthz"`:
  `API_HEALTH_HTTP=200`, body `{"status":"ok"}`.
- App screenshot at `/`: password landing page rendered. This did not
  authenticate, start a source job or inspect a live docket row.

Raw transient command logs: `/tmp/bail-baseline-python.log`,
`/tmp/bail-baseline-typescript.log`, `/tmp/bail-after-python.log`,
`/tmp/bail-after-typescript.log`, `/tmp/bail-typecheck.log`,
`/tmp/bail-build.log`. These are local logs, not committed test artifacts.

### Development migration and state preservation

Before application, printed comparison:

| Target | Database | Host fingerprint | Basis |
|---|---|---|---|
| Development | heliumdb | da3482a1dba6ed20b916a1e69efd2e0b | Unix socket directory |
| Production | neondb | 1d7771392bacb28ae42bc6bd642985c3 | TCP server address |

No credentials/raw hosts were printed. Different database names and
fingerprint bases/values established distinct targets. No scratch-only
substitute was used.

The development-only SQL callback executed the exact migration file:
`ALTER TYPE public.bail_financial_basis ADD VALUE IF NOT EXISTS 'RECORDED_BAIL_AMOUNT';`
It returned `ALTER TYPE`, exitCode 0, success true. The label already existed
in development, so no missing-value addition is claimed. Subsequent development
readback showed five labels; production readback still showed only
TOTAL_BAIL, CASH_DEPOSIT, SURETY_BOND, UNSECURED_AMOUNT.

The actual-table fixture transaction/readback/rollback regression ran through
`node tests/run-completion.mjs`, exit 0. It asserted 10000 cents, separate
10.00%, page 1, exact evidence and no remaining saved fixture UUID after rollback.
The enum itself cannot drop one label transactionally; retain the additive
label. No destructive type replacement or production change is proposed.
Exact reproduction command and full acceptance inventory:
`docs/public-http-enum-development.md`.

Read-only row fingerprints before/after all work and local restart were equal:

Each fingerprint is an MD5 comparison checksum of *all columns* in the selected
rows, not a hash of only their count or IDs. For each table the query serialized
each full row with `row_to_json(t)::text`, sorted rows by primary key `id`,
joined those serialized rows with `|`, and computed `md5(string_agg(...))`.
The `historical_items` scope restricts the rows to the single historical
`job_id`. The queries returned only scope, row count and checksum—not row
contents. This is a before/after equality check, not a cryptographic
tamper-proof audit.

The exact query used was:

```sql
SELECT 'source' AS scope, count(*) AS rows,
       md5(string_agg(row_to_json(t)::text, '|' ORDER BY id)) AS fingerprint
FROM public.discovery_source_control t
UNION ALL
SELECT 'requests', count(*),
       md5(string_agg(row_to_json(t)::text, '|' ORDER BY id))
FROM public.discovery_requests t
UNION ALL
SELECT 'historical_job', count(*),
       md5(string_agg(row_to_json(t)::text, '|' ORDER BY id))
FROM public.discovery_jobs t
WHERE id='b0768e5d-a4d7-42df-861f-35754db30bc5'
UNION ALL
SELECT 'historical_items', count(*),
       md5(string_agg(row_to_json(t)::text, '|' ORDER BY id))
FROM public.discovery_items t
WHERE job_id='b0768e5d-a4d7-42df-861f-35754db30bc5';
```

| Retained scope | Rows | MD5 fingerprint, before = after |
|---|---:|---|
| Source control | 1 | 4979c77a5648b55104b6a2274de91026 |
| Request ledger | 106 | 842638d909eef954247ca4a55b24cc5a |
| Historical calendar job | 1 | 554d90ef3de0972287dd6b1ddd16340c |
| Historical job items | 38 | 47dbe07d06af398739eb6c19461bc23a |

The final check printed `retainedStateUnchanged: true`, zero source-capable
active jobs, idle=true, ACCESS_DENIED, and proof/method/approval null=true.
No source request was created, edited or deleted.

## 3. Everything not run, and why

- Every A1–A7 live acceptance item: excluded from Phase 2.
- Probe scripts, assess-download, RESEARCH_PROOF and RESEARCH_RUN: forbidden/
  excluded; the assessment command's scheduler incompatibility remains.
- SINGLE prepare/approve/run, collection approval, source clearing and resume:
  written proposals only, with the approval/audit and timing issues unresolved.
- Five-/ten-/larger-document batch or live MDJ work: not authorized.
- Production DDL, publishing, deployed-revision verification or production
  acceptance: production was read-only; published SHA remains unknown.
- A v17 implementation, retry or automatic fallback: only the design note was
  written. A failed future calendar must stop.
- Five unavailable genuine-PDF regression cases: specific local files missing;
  no court fetch, generated replacement or synthetic case was substituted.
- Authenticated live docket screen/CSV comparison and owner portal comparison:
  no fresh live data or owner action. Static landing screenshot is not A5/A6.

## 4. First unresolved problem

**The existing approval command does not record the approved permit scope and
method in the job event log.** This prevents an auditable connection between
the owner's explicit approval and the one permit. The written proposal now
specifies only the minimal command event; it does not propose per-person
authentication. Approval alone must not clear ACCESS_DENIED.

Also unresolved: the pilot verifier's global spacing predicate versus
operation-specific asset pacing; pre-existing 200-record/500-request env
overrides versus the stated five-document operating boundary; five missing
local PDFs; and the unknown published SHA. No safeguards or environment limits
were changed to remove these issues.

Stopped after this Phase 2 report. Overall live acceptance remains open.

## 5. Current workflow verification (2026-10-25)

This section records a fresh local verification on the current workspace
checkout. No application or test code was changed during this verification.
All commands used offline fixtures or loopback transport; no court request,
permit approval, source clear, or production operation was performed.

### Local checks

| Command | Exact result |
|---|---|
| `cd artifacts/api-server && python -m unittest discover -v -s tests -p test_public_http.py` | `Ran 26 tests in 4.361s` / `OK`; exit 0. |
| `cd artifacts/api-server && python -m unittest discover -v -s tests -p test_calendar_load_timeout.py` | `Ran 27 tests in 43.523s` / `OK`; exit 0. |
| `cd artifacts/api-server && python -m unittest discover -v -s tests -p test_form_inspection.py` | `Ran 48 tests in 65.335s` / `OK`; exit 0. |
| `cd artifacts/api-server && python -m unittest discover -v -s tests -p test_supplied_bail.py` | `Ran 8 tests in 0.270s` / `OK`; exit 0. |
| `cd artifacts/api-server && node tests/run-safety.mjs` | `PASS: 986 offline checks`; `PASS: 33 strict document-response, actual Python redaction, denial propagation and request-timing checks.` Embedded Python: `Ran 218 tests in 216.349s` / `OK (skipped=5)`. Parent accepted 26 actual-worker diagnostics. Exit 0. |
| `cd artifacts/api-server && node tests/run-completion.mjs` | `PASS: criteria normalization/idempotency, new and legacy filters, genuine response contract/date strings, additive financial basis saving/review (rolled back), and session validation.` Exit 0. |
| `cd artifacts/api-server && node tests/run-research-workflow.mjs` | `PASS: operation isolation, fail-closed origins, PDF boundary, configurable pacing, retained backoff and server waits, optional criteria, inclusive/posted filtering.` Exit 0. |
| `pnpm --filter @workspace/community-bail-research run test:discovery-retention` | `PASS: expired empty search explains retention and omits Resume.` Exit 0. |
| `pnpm --filter @workspace/community-bail-research run test:calendar-preview` | `PASS: calendar preview success, validated zero, partial, running, failure and expiry states; no case fixtures.` Exit 0. |
| `pnpm --filter @workspace/bail-research test` | `tests 6; pass 6; fail 0; skipped 0.` Exit 0. |
| `pnpm run typecheck` | Library build and API, community web, mockup sandbox, scripts TypeScript checks all exited 0. |

All four specified Python modules and the complete Python suite now pass on
this checkout. In particular, the calendar cases listed as failures/errors in
the earlier e397963 report passed in the current calendar suite; that earlier
report remains an accurate record of its historical run, not the current
result. The same five unavailable real-document fixture skips remain.

### Authenticated read-only UI check

The development app used its configured workspace-password authentication in
one in-memory Playwright context. The session endpoint returned authenticated,
and `GET /api/discovery/jobs` returned HTTP 200 with 34 jobs. The artifact's
actual preview path is `/`; `/discovery` rendered the “Calendar search and
docket evidence” page. All discovery API writes were blocked during the
browser check, and no court search was submitted.

The historical job detail returned HTTP 200 but zero items because its
`results_expired_at` was already `2026-10-22T08:52:59.793Z`. A development
database read confirmed zero remaining items and five retained request rows.
That expiry timestamp predates this verification; the earlier 38-item
fingerprint in this report is a pre-expiry snapshot. No restoration or
historical-data edit was attempted. The authenticated UI check therefore
verifies the page and protected read path, not a current saved-row screen.
Saving/readback and CSV agreement are covered by the passing rolled-back
completion test and six bail-research tests; an authenticated browser save
against the expired historical job was NOT RUN.

### Current live gate

Read-only development database state on 2026-10-25:

- No queued or running discovery job was returned.
- UJS source control: `blocked_reason=ACCESS_DENIED`; `paused_until`,
  `access_verified_at`, `verified_method`, `collection_approved_at`, and
  `active_request_id` are null; `adaptive_spacing_ms=60000`;
  `latency_warning` is null.
- The historical job criteria store `eventType="Formal Arraignment"`; that
  string was read from the stored criteria, not inferred from a label.
- An existing unused `BOUNDED_ENGINE` permit is `PREPARED` for its old
  2026-10-16–2026-10-22 scope and v12 method. It was neither approved nor used.

No live result is claimed. `ACCESS_DENIED` is still present. Ordinary access
and collection are blocked, but the existing explicitly approved single-use
pilot request path can attempt its exact saved scope while retaining that
denial; approval alone does not clear it. Any successful clearing remains
owned by the pilot's existing success-proof path. A fresh owner confirmation
of exact current criteria is required before one request sequence; any
refusal, challenge, or failure ends that attempt without retry. As of this
2026-10-25 snapshot, no fresh confirmation or live attempt had occurred; see
the subsequent attempt record below.

### Revision and remote

The test worktree was clean before this report update. The observed GitHub
branch head was `29ffa43ec3878e3c79cc9e3090c128c24762731d` from
`git ls-remote origin refs/heads/fix/public-http-document-step`. The local
checkout was one empty “Published your App” commit ahead of that head.
This report update is additive; no history rewrite or application-code change
is included.

## 6. October 27, 2026 authorized attempt

The owner explicitly authorized one integrated attempt and amended the date to
the current day. The exact scope was office `CP-05-02-Crim`, stored event
`Formal Arraignment`, courtroom `ANY`, start/end `2026-10-27`, one docket
(`recordCap=1`, `matchTarget=1`), and `requestCap=12`, using
`playwright-calendar+public-http-pdf-v16`. The 12-request cap was stated in the
confirmation presented to the owner. No other date, office, event, room or
client was substituted.

Before preparation, a read-only development query returned zero active jobs,
zero in-flight source requests and zero matching prior SINGLE permits.
`ACCESS_DENIED` remained set. The query captured these historical fingerprints:

| Historical row set | Count | Fingerprint before and after |
|---|---:|---|
| Job `b0768e5d-a4d7-42df-861f-35754db30bc5` | 1 | `4cec4576b8ea9118a51a4fc6dbc62d6d` |
| Its items | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| Its request rows | 5 | `81034277b5dcd8b0ee4e197ce3b44617` |

Preparation printed permit
`8492633b-f043-44d0-b1e8-cea0999f0784`, `SINGLE`, `PREPARED`, with the exact
criteria above. The separately invoked `approve --user-approved` action
changed it to `APPROVED` for 24 hours and did not send source traffic.

The first `run` invocation stopped at the advisory-lock check because the API
managed worker held the lock. It explicitly reported “no request was made.”
A read-only query then confirmed the permit remained `APPROVED`, had no linked
job, and had no request or active source slot. The idle API service was stopped
to release that lock. The permit's integrated run was then invoked once.

The integrated worker exited before its first protocol request. Exact command
result:

```text
state=FAILED
requests=0
validDocuments=0
failures=0
reason=Pilot did not pass all document, timing, accounting, completion, and latency checks. No automatic retry or collection enablement.
```

The linked job is `7e7eaedd-5885-4064-b583-3f4390bc8629`, status `PAUSED`,
`requestsUsed=0`, `calendarComplete=false`, no items and no request rows. Its
retained event says: `Worker stopped before completion (exit 2; 129 diagnostic
bytes). No automatic retry; partial results retained.` The worker intentionally
does not retain raw stderr because it could contain source content. Therefore
the first failed proof condition is known—local worker exit before any request—
and the specific local cause has now been identified.

Local diagnostics after that attempt passed module import, Python compilation
Chromium startup, and a full no-navigation worker boot. The CLI imports
`discovery-worker.ts` from `src/lib`; resolving `ujs/worker.py` relative to that
module pointed Python at the absent `src/lib/ujs/worker.py`. The actual worker is
`src/ujs/worker.py`. Running Python against the absent path reproduced both
exit code 2 and exactly 129 stderr bytes, matching the retained failed-job
signature. The packaged API uses `dist/index.mjs`, for which `dist/ujs/worker.py`
exists; this explains why the API startup/build checks passed while the source
CLI failed. Earlier fail-closed protocol reproductions stalled without a source
grant and did not establish this cause.

The worker launcher now resolves both source-tree and packaged Python script
locations, including `network_sandbox.py`, and fails explicitly if neither
exists. The research-workflow regression covers both path layouts and a missing
script. `typecheck`, `test:research-workflow`, and the API build/import smoke
check passed. The API workflow restarted and `/api/healthz` returned HTTP 200.
These are offline verification only; no live attempt was repeated.

After restarting the API, the authenticated read-only browser check returned
HTTP 200 for the new job and rendered its pause message. The visible job state
was `PAUSED`, with zero requests/items; CSV export was disabled. Browser-side
non-GET API methods were blocked; no search or save request was made. Existing
GET handlers can run retention cleanup; the target historical fingerprints
were queried again after this browser check and still match. No court request,
calendar result, PDF, bail extraction, save/reload journey or live CSV
comparison occurred.

Post-run fingerprints match the pre-run values in the table. The historical
job, items and five old request rows remain unchanged. Source state remains
`ACCESS_DENIED`, with no active request and no collection approval. The failed
SINGLE permit is consumed and cannot be reused. No retry was made. End-to-end
live acceptance remains **INCOMPLETE**; any future source attempt requires a
new exact scope confirmation and a new permit. This path fix does not establish
calendar access, PDF retrieval, bail extraction or the saved-result journey.
