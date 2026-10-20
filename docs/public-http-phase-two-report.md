# Section 10 — Phase 2 report

Scope: amended offline-only work order. No court requests, probe reruns,
preparation/approval/run commands, source clearing, resume, Phase 3, production
DDL or publication. MET below refers only to the amended Phase 2 requirement;
it does not mean live acceptance.

Branch: `fix/public-http-document-step`, created at
`3d0cca2fee706316e92589dee61f758765da348a`.

Implementation commit:
`8cb87a6111f1d4c49091f15f393afbfd5d33389f`.
Initial proposal/evidence commit:
`f800f55108cf3f5f1df2343fdc0209a4dd86c9bb`.
The final reporting commit adds this report, an approval-identity clarification
and database-separation memory; it changes no tested application code.

Baseline tests ran on the clean exact-base worktree, with installed dependency
links and local genuine PDFs available. Post-change tests started at that base
plus the implementation changes, whose exact code/test bytes were subsequently
committed as 8cb87a6. Documentation changed during verification; application
and test code did not. The preview checkout is now on the requested branch.
The original `fix/calendar-result-integration` branch was not advanced.

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
`playwright-calendar+public-http-pdf-v16`. Safety suite exited 0 and printed
`PASS: 986 offline checks; actual concurrent PostgreSQL grants; no court traffic or case fixtures.`
Method comparisons remain exact, with no v15 compatibility path.

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
an explicit 127.0.0.1 connector, preserving the original request target.
Post-change full suite: `Ran 217 tests in 266.039s`, `OK (skipped=5)`, exit 0.

Not verified: five existing real-PDF tests remain skipped because their
specific local source files are unavailable. No files were fetched to fill
those gaps.

### R-10: MET
Evidence: written-only `docs/public-http-owner-approval-proposal.md` identifies
the missing specific-run in-app approval, named approver/method audit and
post-success clear linkage. Current shared-password identity does not identify
an individual approver. No new approval or authentication mechanism was coded.

Not verified: named owner approval/clear cannot be accepted live yet. A CLI
flag, shared workspace ID or typed approver name is not the required identity.

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

Paths below are relative to the repository root. No probe, work-order,
attached_assets, dependency manifest, lockfile, workflow or artifact configuration
file was committed.

| Path | Reason |
|---|---|
| artifacts/api-server/src/lib/discovery-safety.ts | v16 integrated method only. |
| artifacts/api-server/src/ujs/worker.py | Public HTTP document call; remove live popup/session gate; bounded evidence and capture timing. |
| artifacts/api-server/src/ujs/calendar_document.py | Historical-v15 label, module retained. |
| artifacts/api-server/src/ujs/document_diagnostics.py | Conservative bounded refusal evidence and elapsed-time helper. |
| artifacts/api-server/src/lib/document-response.ts | Strict response validator and safe event projection. |
| artifacts/api-server/src/lib/discovery-worker.ts | Validate response, account unchanged scheduler path, publish safe duration/denial events. |
| artifacts/api-server/build.mjs | Include the new Python helper in the packaged worker. |
| artifacts/api-server/tests/test_public_http.py | Real loopback downloader matrix, diagnostics and normal-worker grant/disposal tests. |
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
| docs/public-http-owner-approval-proposal.md | Unimplemented specific-run identity/approval/audit requirement. |
| docs/public-http-calendar-v17-note.md | Conditional one-page v17 design only; no fallback implemented. |
| docs/public-http-phase-two-report.md | This section 10 report. |
| .agents/memory/MEMORY.md | Index the non-obvious database identity lesson. |
| .agents/memory/database-separation.md | Record why a null server IP must not become an “unknown” host fingerprint. |

Both specifically requested mock edits retain the original refusal assertion;
neither test was deleted, skipped or weakened.

## 2. Exact commands and results

Commands ran from `/tmp/bail-public-http-phase2` unless a different directory
is shown. The preview checkout was switched only after the implementation and
proposal commits, with the owner's five later-added files restored byte-for-byte
as untracked files, not staged.

### Baseline versus after

| Command / working directory | Baseline at 3d0cca2 | After, code bytes of 8cb87a6 |
|---|---|---|
| `cd artifacts/api-server && python -m unittest discover -v -s tests -p 'test_*.py'` | 191 total: 184 pass / 2 fail / 5 skip; exit 1 | 217 total: 212 pass / 0 fail / 5 skip; exit 0 |
| `cd artifacts/api-server && node tests/run-safety.mjs` | 953 counted TS checks passed; script exit 0 | 986 counted TS checks passed; script exit 0 |
| Python discover invoked internally by run-safety.mjs | 191 total: 186 pass / 0 fail / 5 skip | 217 total: 212 pass / 0 fail / 5 skip |
| `cd artifacts/api-server && node tests/run-completion.mjs` | 1 script pass / 0 fail / 0 skip; exit 0 | 1 script pass / 0 fail / 0 skip; exit 0 |
| `cd artifacts/api-server && node tests/run-research-workflow.mjs` | 1 script pass / 0 fail / 0 skip; exit 0 | 1 script pass / 0 fail / 0 skip; exit 0 |
| `pnpm --filter @workspace/community-bail-research run test:discovery-retention` | 1 script pass / 0 fail / 0 skip; exit 0 | 1 script pass / 0 fail / 0 skip; exit 0 |
| `pnpm --filter @workspace/community-bail-research run test:calendar-preview` | 1 script pass / 0 fail / 0 skip; exit 0 | 1 script pass / 0 fail / 0 skip; exit 0 |
| `pnpm --filter @workspace/bail-research test` | 5 named tests pass / 0 fail / 0 skip; exit 0 | 6 named tests pass / 0 fail / 0 skip; exit 0 |

There are **six TypeScript entry points, all passing before and after**, with
zero failed/skipped entry points. The monetary native-test entry is one of
those six. The other custom assertion scripts do not emit a unified native
test-case total; their entry-point and explicit check counts above are exact.
Do not add entry points, safety check counters and native tests into a
fictional single “unique test” count.

All TypeScript test-file inventory is covered: bounded-launch, calendar-layout,
document-locations, job-criteria and new document-response through safety;
inspection-broker checks through safety; completion and research-workflow
through their scripts; calendar-preview/discovery-retention through web scripts;
monetary through its native test runner.

**Duplicate execution:** run-safety invokes the full Python suite, not extra
unique coverage. research-workflow is also imported by safety and separately
run by its script. Those repeats are disclosed, not added to unique totals.
Baseline Python and run-safety were concurrent; post-change runs were
sequential to avoid that extra test-load overlap.

### Every existing test whose result differed

1. `test_calendar_load_timeout.CalendarLoadTimeoutTests.test_large_response_validates_explicit_empty_early_and_late`:
   baseline FAIL (`CALENDAR_RESULT_LOAD_TIMEOUT` instead of no barriers);
   post-change PASS.
2. `test_calendar_response_size.BrowserStreamTests.test_denials_challenges_and_redirects_never_become_results`:
   baseline FAIL in status=200/CHALLENGE subcase (`NETWORK_ERROR` instead of
   CHALLENGE); post-change PASS.

Both already passed in the untouched-base Python rerun inside run-safety.
No claim is made that v16 corrected those intermittent baseline failures.
Their assertions and calendar implementation were not weakened.
No existing PASS became FAIL/SKIPPED; all five existing skips are unchanged.
There are 26 new Python tests and one additional native monetary test; the
new imported TypeScript response checks contribute 33 to safety's check count.

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

**The required specific-run in-app owner approval and audit do not exist.**
Current shared authentication cannot name an individual approver. The existing
CLI's approval timestamp is not that audit, and approval alone does not clear
ACCESS_DENIED. Live work must remain blocked pending review of the written
identity/approval design and the A7 wording.

Also unresolved: the pilot verifier's global spacing predicate versus
operation-specific asset pacing; pre-existing 200-record/500-request env
overrides versus the stated five-document operating boundary; five missing
local PDFs; and the unknown published SHA. No safeguards or environment limits
were changed to remove these issues.

Stopped after this Phase 2 report. Overall live acceptance remains open.
