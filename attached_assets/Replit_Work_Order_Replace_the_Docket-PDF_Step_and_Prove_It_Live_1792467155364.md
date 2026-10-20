# Replit Work Order: Replace the Docket-PDF Step and Prove It Live

Repository: boredpunks/Community-Bail-Research-Tool. Base: branch `fix/calendar-result-integration` (3d0cca2). Do not work on `main`.

This is a work order, not a suggestion list. Every numbered requirement (R-n) must be reported against with evidence. Where a requirement cannot be met, say which one and why. Do not summarize progress as "done", "working" or "complete". Report only what was run and what it printed.

---

## 1. What is established and what is not

### Established (evidence exists outside this repo)

| Fact | Evidence |
|---|---|
| From this Replit environment, a plain Python standard-library client with User-Agent `CommunityBailResearch-SourceAssessment/1.0` received HTTP 200 for GET `/CaseSearch` (2,605,160 bytes), HTTP 200 for a POST calendar search (3,716,735 bytes, 1,002 CP docket links, 431 distinct dockets, CP-05-02-Crim, 2026-10-19 to 2026-10-23), and HTTP 200 `application/pdf` (76,602 bytes, starts `%PDF-`) for one `/Report/CpDocketSheet` link taken from that result. | Probe 1 output pasted by the owner from this Replit shell. |
| The same byte counts were obtained from a different network (the research agent's workspace). | Agent's own run. |
| The PDF GET in the agent's run used no cookies, no Referer and no redirects. | Agent's own run. |
| The repo's `evidence.extract_bail` read that PDF without error: bail section found on page 2, outcome `AMBIGUOUS_FINANCIAL_ASSOCIATION`, no entries. The bail rows on that docket were Bail Type "Denied", Amount $0.00. The parser did not invent an amount. | Agent's own run. |
| Today the shipped worker's PDF step (headless Chromium popup, method `playwright-calendar+native-session-pdf-v15`) is reported to have received HTTP 401 on a result-linked docket. | Job `b0768e5d-a4d7-42df-861f-35754db30bc5`, assessment `57f415a3-bb68-4fc1-84b6-ad24a531435e`. Body and headers were not retained. |

### Not established (do not claim any of these)

1. That the app's own `public_http.download` (no cookies, no Referer) is served from Replit. Probe 1 sent cookies on the PDF GET. Probe 2 (`plain_http_probe2.py`) removes them. Run Probe 2 first (R-1).
2. That a `dnh` link captured by the Playwright calendar session works when requested by a different client. It is expected to, because the agent's no-cookie GET worked with a link from a plain-HTTP search, but this has not been shown for Playwright-captured links.
3. How long a `dnh` link stays valid.
4. Anything about MDJ (`/Report/MdjDocketSheet`) dockets. Everything above is Common Pleas only.
5. Why the headless popup receives 401. Do not assert a cause. Capture evidence instead (R-8).
6. Whether the Playwright calendar step will keep working. It validated 38 rows on the last run. Treat it as working but unguaranteed.

---

## 2. Forbidden actions (stop immediately if any seems necessary)

F-1. No proxies, VPNs, rotating addresses, residential or datacenter relays.
F-2. No change to User-Agent to look like a browser. The identifier stays exactly `CommunityBailResearch-SourceAssessment/1.0` unless the owner approves a new one in writing, and any change must be retested from scratch.
F-3. No stealth flags, fingerprint changes, `navigator.webdriver` patches, headless-detection evasion, or cookie export from Playwright into another client.
F-4. No CAPTCHA solving, challenge handling, login, or use of any authenticated or sealed content.
F-5. No retry loops, no automatic retry after 401, 403, 429, a challenge page, a redirect, or a timeout. One request per grant, as the existing limiter already enforces.
F-6. No parallel requests. No lowering of the existing pacing or caps. No raising of the 500-row calendar cap.
F-7. No constructing docket URLs from docket numbers. Only the exact link captured from a validated calendar result row may be requested (existing rule; keep it).
F-8. No following redirects on the PDF request (existing `NoRedirect`; keep it).
F-9. No synthetic, example or fixture data in any live path, report or CSV. Fixtures stay in tests only.
F-10. No deleting, editing, relabeling or "clearing" the retained ACCESS_DENIED rows or any prior request ledger entry.
F-11. Nothing may clear the source pause or the ACCESS_DENIED stop except an explicit owner action recorded as an audit event (R-10). The worker itself must never be able to clear it.
F-12. No claim of success from offline tests. Offline tests prove code paths only.

---

## 3. Design decision (fixed; do not redesign)

Keep the Playwright calendar search exactly as it is. It is the only part reported to have worked on Replit. Replace only the document retrieval.

Current: `worker.py` around line 1029 calls
`retrieve(item["sourceUrl"], "GET", lambda: browser_document.open(item["sourceUrl"]))`
which uses `CalendarDocument` (a Chromium popup in the calendar's browser context).

New: call the existing `public_http.download(item["sourceUrl"])` instead. It already:
- accepts only `allowed(url, "GET")` URLs on the two report paths,
- sends no cookies,
- refuses redirects,
- reads at most 4,000,001 bytes,
- returns an object with `status`, lowercased `headers`, `body()` and `dispose()`, which is the contract `retrieve()` expects (it reads `response.status`, `response.headers`, `await response.body()`, `getattr(response, "outcome", "OK")` and `await response.dispose()`).

`classify_response(...)` in `source_protocol.py` then classifies status, size, content type and PDF signature exactly as before.

Why this and nothing larger:
- It reuses code that already exists, was already assessed, and has its own offline tests path (`assess-download.py`).
- It changes one call site, not the calendar machinery.
- A plain-HTTP calendar search also worked from both networks, but replacing the working calendar is a separate decision. Do not do it in this work order (see section 9).

---

## 4. Phase 0: Read-only inspection (no edits, report before coding)

Report the following with file paths and line numbers. Quote only short lines. If any answer differs from section 3, stop and report; do not improvise.

R-0.1 In `artifacts/api-server/src/ujs/worker.py`: confirm the exact line that calls `browser_document.open`; confirm `retrieve()` accepts any fetcher returning an object with `status`, `headers`, `body()`, `dispose()` and optional `outcome`.
R-0.2 In `public_http.py`: confirm `_download` sends no cookies, no Referer, uses `NoRedirect`, timeout 45 s, reads 4,000,001 bytes.
R-0.3 In `calendar_document.py`: list every place it is imported or referenced (`worker.py` lines 17, 183, 382, 543, 1029 at last read). State what breaks if line 1029 stops using it.
R-0.4 In `src/lib/discovery-safety.ts`: show `integratedSourceMethod` and every place it is compared or stored (access proof, collection approval, `verifiedMethod`).
R-0.5 In `src/lib/research-operations.ts` (about lines 25-45) and wherever `accountSourceResponse` is defined: show exactly what sets and what clears `blockedReason = "ACCESS_DENIED"`, `accessVerifiedAt`, `verifiedMethod`, `collectionApprovedAt`. Describe the steps the owner must take today to lawfully clear the stop under the repo's own rules.
R-0.6 In `assess-download.ts` / `assess-download.py`: confirm it uses `public_http.download` against a stored result-linked docket URL, requires `--approved-one-request`, requires a PAUSED job with `calendarComplete` and a matching `requestsUsed`, and does not clear the pause.
R-0.7 Query the database (read-only SQL) for job `b0768e5d-a4d7-42df-861f-35754db30bc5`: status, `calendarComplete`, `requestsUsed`, number of items, count of items by `provenance.extractionOutcome`. Do not print names, DOBs or any party data.
R-0.8 Query the request ledger (`discovery_requests` or equivalent) for the last 20 rows: id, path, method, outcome, status code, timestamp, and which `method` id they were made under. Do not print URLs or query strings.
R-0.9 State whether the production database enum includes `RECORDED_BAIL_AMOUNT`. Previous report says it does not. Show the `\dT+` style output or the equivalent.
R-0.10 State whether cancelling a run stops its child processes (`detached: true` in `assess-download.ts` and `process.kill(-pid)`). Show the code that does it.
R-0.11 State the published app revision (git SHA deployed) and whether it matches 3d0cca2.

Stop after Phase 0 and post the report. Continue only if nothing contradicts section 3.

---

## 5. Phase 1: Prove the exact method works from this network (no repo edits)

R-1. Run `python3 plain_http_probe2.py 2026-10-19 2026-10-23` from the Replit shell (this file is delivered with this work order). It makes 3 requests, 5 seconds apart, prints only status codes and counts, and uses a fresh opener with no cookies and no Referer for the PDF GET.

Report the full printed output, unedited.

Decision rule:
- `RESULT: PORTAL SERVED SEARCH AND DOCKET PDF TO THIS NETWORK` => continue to Phase 2.
- Any other result => STOP. Do not change code. Report status, content-type, byte count, and the first 200 characters of the response body if it is `text/plain` or `text/html` (no cookies, no URLs). Do not rerun, vary headers, or try another approach. The owner decides next.

---

## 6. Phase 2: Code changes (offline only)

Work on a new branch `fix/public-http-document-step` from 3d0cca2. Small commits. Do not squash away history.

R-2. Method identifier. In `src/lib/discovery-safety.ts` change `integratedSourceMethod` to `"playwright-calendar+public-http-pdf-v16"`. This intentionally invalidates all proof and approvals tied to v15. Do not add compatibility code that treats v15 proof as v16 proof.

R-3. Call site. In `worker.py` replace
`lambda: browser_document.open(item["sourceUrl"])` with
`lambda: public_http.download(item["sourceUrl"])` (import `public_http`; no other behavior change at the call site). Leave all of `retrieve()`'s limiter, accounting, checkpoint and stop logic untouched.

R-4. Remove the browser-document path from live use. Do not instantiate `CalendarDocument` in the normal worker (line ~543). Leave `calendar_document.py` and its tests in the repo, clearly marked in its module docstring as "superseded by public_http in v16; retained for evidence of the v15 method". Do not delete test files.

R-5. Docket identity and PDF checks. Confirm that, after download, the existing checks still run: `%PDF-` signature, 4 MB bound, `extract_bail(body, docket)` docket identity check, SHA-256 and page count retained. If docket identity is not verified in `extract_bail` for the plain-HTTP path, add the check; a PDF whose docket number does not match the row's docket number must yield `UNSUPPORTED_LAYOUT` or `IDENTITY_MISMATCH` and no amount.

R-6. Spacing. Do not touch `discoveryPolicy.spacingMs`, shared quotas, cooldowns or permit logic. The plain-HTTP request must still be preceded by `emit("request", ...)` and granted by the parent before transmission, exactly as before.

R-7. Statuses. Confirm `classify_response` maps: 429 => RATE_LIMIT; 401 and 403 => ACCESS_DENIED; 3xx => REDIRECT; other non-200 => HTTP_ERROR; 200 with wrong signature => INVALID_PDF; over 4 MB => SIZE_LIMIT. Add no new retry on any of them.

R-8. Safe denial evidence. When a document request returns 401, 403 or 429, record this and only this, in the existing response event or one new minimal message kind (validate it strictly on the TypeScript side; reject unknown keys):
- HTTP status
- `content-type` (media type only)
- `content-length` or byte count
- these response headers if present, lowercased names and values truncated to 200 characters: `server`, `via`, `retry-after`, `www-authenticate`, `date`
- the first 200 characters of the body if the media type is `text/plain` or `text/html`, with any `<...>` tags stripped, whitespace collapsed, and anything resembling a token, query string, cookie or email removed
- never: cookies, `set-cookie`, request URL or query, `dnh`, request headers, party names, PDF text

This exists so that, if a refusal recurs, its cause is visible. It must be unit-tested (R-9) and displayed in the job's event log.

R-9. Tests. Add or update, under `artifacts/api-server/tests/`, a Python test that starts a loopback `http.server` and calls `public_http._download`-equivalent logic. Cases (each its own assertion, named in the test):
1. 200 `application/pdf` with the genuine Common Pleas fixture (`CP-02-CR-0005845-2026`) => extraction records $100, 10%, page 1.
2. 200 with the genuine MDJ fixture (`MJ-05317-CR-0000264-2026`) => $1,000, posted, page 2.
3. 200 with the genuine MDJ no-monetary-bail fixture (`MJ-05310-NT-0000228-2026`) => no monetary bail.
4. 200 with a PDF whose docket number differs from the requested row => no amount, identity failure.
5. 401 with `text/plain` body "Unauthorized request" => ACCESS_DENIED, evidence captured exactly as R-8 specifies, no cookies or URL in the captured evidence.
6. 429 with `Retry-After: 120` => RATE_LIMIT, retry-after preserved, no second request.
7. 302 to another path => REDIRECT, redirect not followed (assert the server saw exactly one request).
8. 200 `text/html` with the word "verify you are human" => CHALLENGE.
9. 200 with a body of 4,000,002 bytes => SIZE_LIMIT.
10. 200 with `text/html` and no `%PDF-` => INVALID_PDF.
11. URL not on the two report paths, a different host, a URL with extra query keys, or a docket-number pattern mismatch => REQUEST_NOT_PERMITTED, zero requests made.
12. The server records the request headers; assert User-Agent is exactly `CommunityBailResearch-SourceAssessment/1.0`, there is no `Cookie` header, no `Referer` header, no `Authorization` header.
13. Exactly one request per call; no retry on any failure (server counter).

Also run, and report counts for, all existing suites: every `artifacts/api-server/tests/test_*.py`, and the TypeScript suites (`bounded-launch.test.ts`, `calendar-layout.test.ts`, `document-locations.test.ts`, `job-criteria.test.ts`, plus the `run-*.mjs` scripts). Report which suites were not runnable and why. Report typecheck and build results. If an existing test fails because of the v16 change, fix the test only where it asserts the v15 method string or the popup path; do not weaken any safety assertion.

R-10. Owner-only clearing. If the repo has no explicit owner command to clear the ACCESS_DENIED stop after a successful reviewed assessment, describe in writing (do not implement) the smallest command that would, using the repo's existing validation-only command pattern. Do not run it.

---

## 7. Phase 3: Live validation (each step needs the owner's in-app approval; stop on any failure)

Do not begin Phase 3 until Phase 1 printed the success line and Phase 2 offline tests are reported with exact counts.

R-11. Step A, fresh calendar. One calendar search for the existing validated criteria shape (CP-05-02-Crim, one date, event type as the owner selects, existing request cap and record cap). Do not reuse the stale job's links as primary evidence; links may expire. Report: job id, rows validated, requests used.

R-12. Step B, single-document assessment using the existing `assess-download.ts` command with `--approved-one-request`, one PAUSED job with `calendarComplete`, one stored result-linked docket, one request. Report: job id, `requestsUsed` before and after, status code, outcome, byte count, `%PDF-` signature, extraction outcome, SHA-256 prefix (first 12 hex), page count. If the outcome is anything but OK, STOP and report the R-8 evidence. No second attempt.

R-13. Step C, small batch. Only if Step B returned OK and the owner approves: `recordCap` 10 on the same job type, normal pacing. After the batch, stop and report: rows, outcomes by `extractionOutcome`, how many `RECORDED_BAIL_AMOUNT`, `NO_BAIL_SECTION`, `AMBIGUOUS_FINANCIAL_ASSOCIATION`, `RETRIEVAL_FAILED`, any non-200 status and its evidence. If any 401, 403, 429, challenge or redirect appears, the existing logic must pause the source; confirm it did.

R-14. Do not proceed to 50, 100 or 200 dockets without a new owner approval after R-13 is reviewed.

R-15. Bail amount handling. For dockets whose Bail Type is "Denied", "Nonmonetary" or equivalent with Amount $0.00: do not store or display `$0` as a bail amount. They must appear as "no monetary bail recorded" (or the existing equivalent), with the source page and the exact quoted row. A row is never counted toward "low stated monetary bail" unless a monetary amount was extracted from a labeled bail row.

---

## 8. Product rules that remain in force

P-1. One result row = one calendar event + one qualifying observation. Targets count distinct dockets.
P-2. The hearing date comes from the calendar event, not from the PDF.
P-3. The CSV equals the displayed rows. Nothing is added or dropped on export.
P-4. Output must not claim custody status, unpaid bail, current operative bail, absence of other holds, eligibility for assistance, or countywide coverage.
P-5. Allowed phrase: "low stated monetary bail". Banned words in UI and exports: bargain, payable, eligible, recommended, good candidate.
P-6. Every discovery card must carry this exact statement: "This is a discovery result, not a recommendation. The stated bail amount does not establish the amount required for release, current custody, absence of other holds, or eligibility for assistance."
P-7. Every extracted fact is traceable: docket number, source document SHA-256, page number, quoted row text, retrieval timestamp, method id.
P-8. Minimize personal data: do not persist or display party names, dates of birth, addresses, SSNs, OTNs or charge narrative beyond what the existing schema already holds. Do not add new personal fields.
P-9. Uncertainty is preserved: ambiguous association stays "ambiguous", not converted to a best guess.

---

## 9. Out of scope for this work order (do not start)

- Replacing the Playwright calendar with a plain-HTTP calendar search (it worked in tests from two networks; consider later only if the Playwright calendar fails).
- MDJ documents. Requires its own Phase 1 probe with a real `/Report/MdjDocketSheet` link and its own owner approval.
- Population-wide collection, scheduling, or any run above the existing caps.
- Contacting courts, the AOPC, or any person.
- UI redesign.
- A bulk data request to the AOPC (the owner may pursue this separately).

---

## 10. Reporting format (use this exactly)

For each of R-0 through R-15 write:

```
R-n: MET | NOT MET | NOT RUN
Evidence: <command, file:line, test name, or job id and printed output>
Not verified: <what this does not prove>
```

Then list:
1. Files changed (path and a one-line reason).
2. Exact test commands run and their exact pass/fail/skipped counts.
3. Everything that was not run, and why.
4. The first unresolved problem, if any.

Forbidden in the report: "should work", "likely fixed", "production-ready", "complete", "verified" without a quoted output beside it.
