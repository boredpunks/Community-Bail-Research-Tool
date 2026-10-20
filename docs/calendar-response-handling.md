# Bounded calendar response handling

## Incident and exact old limits

The October 19 calendar-only attempt is documented in
`calendar-live-acceptance.md`. Its only Search POST returned HTTP 200 and
`SIZE_LIMIT`. That outcome establishes that the body passed to
`source_protocol.classify_response` exceeded 4,000,000 bytes, **not its exact
size or media type**. The old classifier tested size before content type or
HTML denial markers. The ledger and diagnostics retained neither a byte count
nor response headers, and parsing did not run. No result content, valid rows,
empty state, or absence of challenges can be inferred.

There were three independent bottlenecks:

1. `source_protocol.py`: `len(body) > 4_000_000`, after
   `await response.body()` in `worker.py`. This measured decoded entity bytes.
   The installed Playwright driver's API fetch path decompresses gzip/deflate/br,
   collects response chunks, and retains the concatenated body. Python then
   receives another body representation. This was not a compressed-wire cap,
   nor a streaming receive bound.
2. `worker.py`: `len(await page.content()) > 4_000_000`. This created another
   full-page serialization and measured Python Unicode characters, not bytes.
3. `calendar_diagnostics.py`: `document.documentElement.outerHTML.length`
   compared to 4,000,000. This created a full DOM serialization just to measure
   JavaScript UTF-16 code units.

The default `route.fulfill(response=...)` path also requested the API response
body again. The original API body, Python bytes, browser transfer/DOM, browser
full-document serialization, and Python markup string could coexist. These
checks applied different units and could reject a supported page at different
stages. A larger transport check alone would not repair the other two.

## Explicit policy

`UJS_CALENDAR_HTML_MAX_BYTES` sets the maximum **decompressed HTML entity
bytes per calendar document**. Default: **16,000,000 bytes**. Allowed
configuration: **4,000,000–32,000,000 bytes**, inclusive. Invalid configuration
fails before any browser/source request.

This is an application resource policy, not a court-published rate or result
guarantee. The default provides four times the former incidental shared limit
for bounded form/result HTML while retaining the existing 5,000-row structural
ceiling and adding a 200,000-node traversal ceiling. It is not based on an invented
measurement of the failed page. Raising the configured cap beyond 32 MB
requires an explicit code/policy change and regression evidence.

PDFs, PDF uploads, and JS/CSS assets keep their separate 4,000,000-byte limits.
Non-calendar inspection/filing receive paths retain their old limits too.
Document retrieval remains disabled in ordinary calendar jobs. Eight request
slots, one Search submission, sequential grants, shared quotas/backoff, and no
automatic retries or pagination remain unchanged.

## Receive, decoding, parsing, and storage

The calendar document now continues the **original Chromium request**, rather
than making a Playwright API-helper fetch followed by a replacement response.
The parent's persisted grant and pacing still precede transmission. Original
form data, cookies, and browser TLS handling remain in Chromium. This is a
changed integrated receive path; old client evidence is not live proof of it.

- A response-header interception checks status and media before continuing.
  Redirects, HTTP denials/rate limits, unsupported types, and network failures
  stop rather than following a new URL. Playwright's `continue_()` alone can
  bypass routing on redirect continuations, so the header gate is required.
- `Network.streamResourceContent` supplies Chromium-decoded entity bytes.
  The browser's pre-stream retention and application aggregate body allowance
  are bounded by the configured cap. A compressed small `Content-Length` does
  not authorize an unbounded decompressed body.
- Concurrent initial buffered data and later streamed data share one byte
  allowance. Missing/evicted data or a byte-count mismatch fails closed.
  The application retains a single bounded bytearray, plus bounded transient
  protocol chunks. It does not send a full body back into Chromium.
- Only original `Network.loadingFinished` establishes transport completion.
  `loadingFailed`, interrupted streams, timeout, missing stream support, or
  exceeded caps do not become accepted partial pages. Experiments showed that
  EOF from `Fetch.takeResponseBodyAsStream` could hide a Content-Length mismatch;
  replacing/fulfilling that body would hide the upstream failure. That approach
  is intentionally not used.
- Full-body denial, challenge and login classification runs within the cap.
  An over-limit body remains stopped/unvalidated; it is not declared benign.
  Source-grid framing is checked with incremental text decoding and no retained
  cells or action URLs, before browser-repaired markup could mask truncation.
- The parent accounting acknowledgement and route handling settle before
  passive result inspection. Native browser completion can precede that
  acknowledgement, so the worker explicitly waits rather than inspecting
  while the request lock remains held.
- A bounded DOM walk checks the whole page for pagination and result-limit
  warnings, including markers after the result table. Only the bounded result
  table is serialized for the existing parser; no `page.content()` or
  document-wide `outerHTML` copy remains. Original source actions are preserved,
  not constructed. Every existing identity/date/scope/link check still applies.
- Calendar rows and source actions are stored only after the existing result
  validation and eligibility gates. Explicit empty-state proof is still required;
  header-only tables are not empty results. Limit warnings or pagination keep
  coverage incomplete even with otherwise valid parsed content.

Browsers necessarily build a DOM, and DevTools protocol strings/chunks and the
bounded grid serialization have transient overhead. This is a bounded response
and extraction policy, not a claim of process-wide browser memory isolation.

## Retained safe diagnostics

`CALENDAR_RESPONSE_SIZE` records only a version, fixed measurement label,
configured cap, observed decoded bytes, completion flag, HTTP status (or null
before headers), and allowlisted media/encoding categories. The parent validates
the exact field set before persisting it.

For an exceeded cap, `observedBytes` saturates at `limitBytes + 1`: it is a
lower bound proving exceedance, not a claimed total response size. No raw
headers, body/DOM, form fields, URLs, cookies, or docket identifiers are logged
in this diagnostic. New metadata does not retroactively fill the incident's
missing measurements.

## Offline regressions and next live check

Synthetic fixtures contain structural/status HTML and non-case sentinels,
never fabricated case records. Local receiver tests cover large early/late
grids, gzip decoded-byte accounting, new-cap overflow, interrupted transport,
header-only ambiguity, late pagination/limit warnings, unchanged actions,
denials/challenges/login pages, redirects without a second request, unchanged
PDF/asset limits, configuration bounds, and body-buffer identity/disposal.
Worker regressions additionally exercise form submission, parent-protocol
accounting, eligibility, coverage, and the source stop path through the existing
loopback transport adapter. The original Chromium receiver is exercised separately
with an actual local HTTP server, not mocked response events. These tests do not
establish court access or validate real case records.

Verification passed: API build and packaged imports, workspace typecheck,
research-workflow/metadata regressions, nine receiver/policy tests, 24 worker
tests, and 54 protocol/parser/diagnostic tests. Commands:

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run test:research-workflow
cd artifacts/api-server
PYTHONPATH=tests python -m unittest test_calendar_response_size
PYTHONPATH=tests python -m unittest test_calendar_load_timeout
PYTHONPATH=tests python -m unittest test_calendar_protocol test_calendar_parser_structure test_protocol test_calendar_diagnostics
```

No additional court requests are authorized by this repair. The original
`SIZE_LIMIT` stop and request ledger remain intact. Before another live request:

1. Complete repository approval and separately assess the retained operation
   stop without erasing historical failures or introducing pilot permits.
2. Obtain a fresh deliberate user initiation for the exact one-day scope.
   For October 19, 2026, the input is office/room/event `ANY`, dates
   `2026-10-19` through `2026-10-19`, Scheduled Events Only, Allegheny–05,
   eight total transmissions, one Search POST, and no documents/retries.
   If that date has passed, do not substitute a date silently.
3. Verify new size metadata, submitted criteria, actual ledger, validated rows
   **or** explicit-empty proof, complete captured source actions, coverage,
   and authenticated reload persistence independently of PDFs.
4. Stop on denial/challenge/uncertainty or any new limit. Do not label the task
   complete until that live evidence exists.
