# Ordinary authenticated research

## Current direction

The Search screen is a user-driven research tool. Ordinary authenticated
Calendar Event searches do not require an operator, a pilot, PDF regressions,
or a single-use permit. Historical operator reports remain history, not an
ordinary-user approval system.

Search uses Allegheny–05, Scheduled Events Only, and exact optional office,
room and event labels. ANY means no filter. All-filter-blank searches are one
day; filtered windows are at most seven days. The adapter checks actual source
controls and submitted values and stops rather than substituting an unavailable
criterion. An authenticated user explicitly starts each job with fixed search
criteria and budgets; no separate per-run pilot permit is required.

Jobs may retrieve identity-checked docket PDFs after the integrated source
method is verified. The request budget defaults to 12 and can be set up to 500;
the processed-record cap is at most 200. All transmitted calendar, asset,
search and document requests count. Matching targets count distinct dockets,
not every document processed. Reaching a budget can leave the target unmet.
There are no automatic retries or automatic pagination.

Calendar rows, source-provided actions, explicit-empty proof, coverage flags,
request ledger and final status are retained independently of documents.
An empty item list alone never establishes an empty search result.

## Denial evidence and operation scope

The retained failure was an actual HTTP 401 from GET
`/Report/MdjDocketSheet`, made by the separate no-cookie urllib client during
the regression-sample operation. Its URL was constructed from a supplied
regression docket, not captured from a current calendar action. Redirects were
disabled. The response does not establish why access was denied or that the
calendar was denied.

`accountSourceResponse` previously promoted every failed operation to one
source-wide blocked reason. Calendar admission then required an unrelated
validation-barrier state. That conservative application policy conflated the
document transport result with calendar admission; it was not evidence of a
published site-wide restriction.

The original ACCESS_DENIED event and request history remain in the ledger.
On October 28, 2026, the integrated clients completed one exact
CP-05-02-Crim / Formal Arraignment run: five successful requests, one
identity-checked docket PDF and three extracted bail entries. The live
assessment verified that method and timing only for that exact scope; it did
not prove broader court, event or date coverage. The saved observation remains
pending review. Ordinary source requests still require a currently verified
integrated method and use the shared per-request scheduler; no separate global
collection-approval flag is required.

Active requests, shared quotas, cooldowns, latency, restart uncertainty and
genuine source-wide restrictions still block admission. Calendar denials and
challenges stop the job; no automatic recovery or retry clears them. Resolve
any actual external access/authentication requirement before a reviewed
operation-specific recovery; changing pacing is not recovery.

The current integrated transport uses the source-provided docket action and
public HTTP retrieval. It does not use cookies, proxies, followed redirects,
challenge solving or retries. New denials, challenges, login prompts, unknown
origins, active cooldowns, latency warnings and uncertain request state still
stop the affected work. A successful retrieval does not prove custody,
freshness, operative status or coverage outside the exact demonstrated scope.
Manual uploads remain a separate, explicitly labelled local workflow.

## Local PDF evidence

Uploads are authenticated, same-origin, PDF-only, limited to 4,000,000 bytes
and 100 pages, and parsed in a time-bounded child process. A selected row fixes
the expected docket on the server. Standalone uploads independently verify a
unique Allegheny court/docket header. File bytes are processed in memory and
discarded; users must keep their original PDF. Metadata, hash, excerpt, page
references and acquisition method are retained.

The additional uploaded sample demonstrates an Originating Court column.
The parser locates the actual headers and column boundaries from PDF text
geometry, keeps each originating court with its entry, and rejects crossed,
unknown, incomplete or ambiguous cells. Percentage conditions are retained;
they do not establish posting or a known TOTAL_BAIL basis. Undemonstrated
originating-court posting tables fail closed.

All entries remain provisional. NOT_SHOWN means no posting entry shown in
the inspected bail section, not nonpayment or incarceration. Multiple
entries do not silently select an operative order. Inclusive maximum-bail
filtering requires a monetary TOTAL_BAIL basis; shown-posted exclusion tests
SHOWN_POSTED, not absence of proof. Eligible entries can be saved pending
review, with manual acquisition preserved. Bare calendar rows cannot be saved
as bail observations.

Standalone uploads use a SHA-256 URN as a local evidence identifier, never
as an invented court URL. No source-document action is displayed for that URN.

## Pacing findings

The application enforces at least 60 seconds after each response, plus
bounded 0–30-second variation, for calendar, asset, search and document
requests. A verified run recorded four response-to-next-request gaps of about
70, 82, 84 and 89 seconds. These are application safeguards, not a published
court rate or a guarantee against throttling.

Higher adaptive delays still win when deterioration, throttling or a latency
warning is observed. Configured shared or documented minima can increase the
wait but cannot lower the protected floor. Required browser assets use the
same sequential scheduler and count against the request budget; optional
resources are blocked locally before transmission. Shared hourly/daily quotas
and server-directed waits remain.

Retry-After is respected, including when attached to an otherwise successful
response. Rate limits stop the job and preserve at least the configured
cooldown, exponential throttle backoff and any longer server-directed wait.
5xx responses stop without retries and establish at least a 60-second
service-error cooldown or the longer server wait. A future user action is not
an automatic retry of the interrupted job.

Only one source request is in flight. The verified live run used the integrated
calendar/PDF method, completed with no failed requests, and met the protected
timing floor. Broader live searches remain subject to the user's exact
criteria, the visible request and record caps, shared quotas and all source
stop conditions; this proof does not establish countywide coverage.

## Verification boundaries

Use the ordinary authenticated UI for user-selected searches, local uploads,
filtering and pending saves. The verified live result was saved as a pending
observation; it was not confirmed or designated operative. The additional real
PDF regression is supplied locally via LOCAL_DOCKET_PDF or the unique matching
upload; no personal record is committed. The four earlier real-document
regressions remain unavailable.

Offline loopback calendar fixtures, mocked UI submission payloads and local
extraction do not constitute live source acceptance. A deliberate
user-initiated search starts each ordinary job; live outcomes must still be
reported separately from offline checks.
