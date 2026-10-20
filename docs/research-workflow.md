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
criterion. A search has eight total transmission slots, one Search submission,
no PDF requests, no automatic retries and no automatic pagination.

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

The original ACCESS_DENIED value and request history are not erased or
relabelled. Ordinary calendar admission may distinguish it only when the
retained denial origins are actual GET report-path 401/403 responses and
there is no retained calendar denial, challenge or login requirement.
Missing/unknown provenance fails closed. Admission is recorded atomically
with the new calendar job, including the unchanged source reason and the
absence of document authority. No exceptional date or permit is involved.

Active requests, shared quotas, cooldowns, latency, restart uncertainty and
genuine source-wide restrictions still block admission. Calendar denials and
challenges stop the job; no automatic recovery or retry clears them. Resolve
any actual external access/authentication requirement before a reviewed
operation-specific recovery; changing pacing is not recovery.

Automated document retrieval is disabled in the ordinary workflow: a complete,
current source link and a verified permitted transport have not been
demonstrated. Manual source actions are never automatically opened, and
replacement document URLs are never constructed. Downloading a PDF outside
the app and uploading it is an explicitly labelled local workflow, not proof
that the automated document client works.

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

The former 60-second scheduler floor and 60–90-second Python resource pauses
were conservative application defaults. No applicable published minimum or
server directive establishing that rate was found in retained evidence.
Historical documents describing those defaults are not current source policy.

Current sequential response-completion defaults:

| Operation | Default |
| --- | ---: |
| Calendar navigation | 1,000 ms |
| Required JS/CSS assets | 250 ms |
| Search submission | 2,000 ms |
| Document requests, if separately supported later | 3,000 ms |

Configuration: UJS_NAVIGATION_SPACING_MS, UJS_ASSET_SPACING_MS,
UJS_SEARCH_SPACING_MS and UJS_DOCUMENT_SPACING_MS, each 250–3,600,000 ms.
An explicitly configured UJS_SPACING_MS is a shared minimum.
UJS_DOCUMENTED_MIN_SPACING_MS (0–3,600,000 ms) retains an applicable external
minimum when one is established. None of these settings grants access.

An untouched historical 60,000 ms database default is not observed backoff.
Actual throttling, deterioration and latency backoff remain effective.
Required assets still use the shared sequential scheduler and count against
the total budget; optional resources are blocked locally before transmission.
Shared hourly/daily quotas are unchanged. The old research-path quota
inflation and two-second override no longer bypass them.

Retry-After is respected, including when attached to an otherwise successful
response. Rate limits stop the job and preserve at least the configured
cooldown, exponential throttle backoff and any longer server-directed wait.
5xx responses stop without retries and establish at least a 60-second
service-error cooldown or the longer server wait. A future user action is not
an automatic retry of the interrupted job.

A future separately authorized document test could propose one in-flight
request, a small document cap and 2–5-second intervals. That is a test proposal,
not an established court-supported rate, and cannot proceed through a denial
or challenge. Current automated document retrieval remains unverified.

## Verification boundaries

Use the ordinary authenticated UI for local uploads, filtering and pending
saves. The additional real PDF regression is supplied locally via
LOCAL_DOCKET_PDF or the unique matching upload; no personal record is committed.
The four earlier real-document regressions remain unavailable.

Offline loopback calendar fixtures, mocked UI submission payloads, passing
builds and local extraction do not constitute live calendar or live document
acceptance. A live calendar demonstration still requires a deliberate
user-initiated search within the selected scope, not a new operator framework.
