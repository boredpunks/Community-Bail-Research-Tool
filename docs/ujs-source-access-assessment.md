# UJS live discovery: paced matching-target jobs use the demonstrated HTTP method

Assessed October 6, 2026. Genuine calendar retrieval and standard-HTTP monetary
document extraction are demonstrated in a signed-in app journey. The original
Playwright-client docket request received HTTP 403.
The user subsequently approved exactly one standard HTTP download assessment.
That request returned HTTP 200 and extracted matching bail evidence into the
existing job. The user then separately approved enabling that method for normal,
explicitly started bounded jobs. The old access pause was cleared only after that
approval and the successful document proof; the original job stayed paused.
The integrated method now uses the exact same standard HTTP transport as the
assessment. Every new denial/rate limit/challenge still pauses source traffic.

## Demonstrated source access

Initial normal cookie/form-token requests returned search forms, not demonstrated
results: four counted portal requests, no redirects or automatic retries. The
reason was not established; those responses were not called empty searches.

After the user approved a bounded browser assessment, ordinary browser form
selection/submission returned `caseSearchResultGrid` for judicial district 05,
Common Pleas criminal court `CP-05-02-Crim`, Bail Hearing, October 6, 2026.
The result contained `CP-02-CR-0005204-2026`. A result page can also contain the
search form. Only validated result rows/links count, never help examples.

That assessment used twelve actual portal requests: ten browser requests
(including HTML/scripts/styles and two submissions) and two result-linked
docket GETs. The first PDF retrieval hit a local excerpt-boundary error; a
second explicitly counted retrieval succeeded. The docket downloads used
Python's standard HTTP client, not Playwright's request client. PDF identity
matched the docket. The minimal bail chronology was:

| Action | Order date | Bail type | Numeric amount retained |
| --- | --- | --- | --- |
| Set | 2026-06-02 | Nonmonetary | null |
| Revoke | 2026-06-10 | Nonmonetary | null |
| Denied | 2026-06-18 | Denied | null |
| Deny (bail modification) | 2026-08-20 | Denied | null |
| Set (bail modification) | 2026-08-27 | Nonmonetary | null |

Printed `$0.00` values are not cash amounts. At this initial assessment, monetary
bail extraction had not been demonstrated. No custody or operative-order conclusion was made.

The source marked calendar dates as future-only with minimum `2026-10-06`.
Only the demonstrated Common Pleas/Bail Hearing path is offered. MDJ,
Preliminary Arraignment, historical windows and remote pagination are not
enabled or silently substituted. The app further restricts windows to seven
days. Official help is context, not proof of retrieved coverage:
https://ujswebportalhelp.pacourts.us/Resources/PDF%20Documents/UJS%20Public%20Calendar%20Schedule%20(Case%20Search).pdf

## In-app journey and specific barrier

A single programmatically signed-in volunteer started a job from `/discovery`
for October 6–12, 2026, with five-document/twelve-request budgets. Saved-record
search was checked first: it did not create a job or contact court sources.

| Requests | Method/path | Outcome |
| --- | --- | --- |
| 1–3 | GET `/CaseSearch` and the allowed stylesheet/script | 200 |
| 4–6 | POST `/CaseSearch` and the allowed stylesheet/script | 200; result table validated |
| 7 | GET `/Report/CpDocketSheet` using Playwright's request client | 403; source-wide ACCESS_DENIED pause |

At the original browser pass, displayed counts were: seven used/completed requests, one failed request; one
discovered docket, zero processed records, zero record-extraction failures,
one unprocessed docket. Its posted state remains UNKNOWN. No supporting bail
excerpt was obtained by this integrated run and nothing was saved or confirmed.
The list-status cache bug found during the pass was fixed with active-job
polling. Future attempted-document failures are explicitly recorded separately
from budget-denied, never-attempted documents.

The calendar table's lack of detected remote pagination is not a countywide or
full-window completeness claim. One docket is not a guarantee of a particular
result count. The briefing's 44 processed dockets are unverified research
context and were not imported.

At that first pass, saving, review, positive monetary-bound comparisons,
second-account isolation and restart/resume remained unverified because of the
source denial. The focused continuation and controlled recovery check below
addressed those gaps without synthetic case records.

## Demonstrated signed-in matching-target journey

A continuation of the same browser check started a new job from `/discovery`
for October 13–19, 2026, CP-05-02-Crim / Bail Hearing, target one matching
docket, strict monetary-total-bail bound of $1,000,000, shown-posted exclusion
off, processing cap five and request cap twelve. The selected high bound was
for verifying genuine monetary extraction, not a finding of low or nominal bail.

The job used seven actual requests: six calendar HTML/script/stylesheet requests,
then one standard HTTP docket GET, all HTTP 200. The persisted request ledger
shows six gaps of at least 30.002 seconds after the prior response completed.
Results: four genuine source-ordered dockets, one processed, one fixed-filter
match, no request/extraction failures, three unprocessed. The worker stopped at
the requested match before fetching another docket; no fallback job was run.
Calendar events also now fail closed if a readable event date falls outside
the original selected range.

The retrieved `CP-02-CR-0002225-2026` has calendar event October 16, 2026 and
filing date April 6, 2026. Its original bail-section excerpt supports:

| Action | Order date | Bail type | Amount in cents |
| --- | --- | --- | --- |
| Set | 2026-03-20 | Monetary / total bail | 1800000 |
| Revoke | 2026-04-01 | Monetary / total bail | 1800000 |
| Denied | 2026-04-01 | Denied, unpriced | null |
| Deny (bail modification) | 2026-07-27 | Denied, unpriced | null |

The two $18,000 amounts are historical entries, not a current operative-amount
or custody finding. Printed $0.00 denial wording remains unpriced. Original
chronology and minimal supporting wording are preserved. Multiple financial
values in one unknown row layout fail closed rather than silently choosing one.
Percentage/deposit-bearing financial rows are not demonstrated and also fail
closed as unsupported; their values must not be assumed to be total bail.
The document's posted state is NOT_SHOWN; the three undownloaded rows are UNKNOWN.

The signed-in report verified these independent local filters:
- Exactly $18,000 as the strict upper bound: zero matching rows.
- $18,000.01: the $18,000 docket is included.
- $500: zero rows; no fabricated small-bail match.
- Shown-posted exclusion: UNKNOWN rows stay visible. This set contains no
  SHOWN_POSTED row, so positive removal of an actually posted entry was not
  demonstrated by this sample.
- Display-filter changes leave the fixed job target/matching count at one of one.

Saving a genuine extracted entry created PENDING/UNREVIEWED evidence with
charge group null. A duplicate save returned the same record and did not add an
observation. Reload preserved it. Source review then confirmed the source match
while explicitly choosing UNRESOLVED for the operative order; no reviewed-operative
amount was established. The tester flagged UNREVIEWED versus UNRESOLVED against
a literal instruction to preserve UNREVIEWED after review. UNREVIEWED is the
pre-review state; the existing review UI's chosen Unresolved option correctly
records UNRESOLVED. Neither state makes the amount operative, and the historical
entry remains excluded from reviewed-operative ranges. No decision was reversed.

A second signed-in account saw no foreign jobs and received 404 for foreign
job read, evidence save and record review. No external court link was opened
by the tester, and no extra source traffic bypassed the collection ledger.

## Controlled restart/checkpoint verification

Using this genuine job's completed checkpoint, an operator temporarily marked
its job state RUNNING (without issuing a source request) to exercise the local
restart-recovery branch. Restart paused it and retained an identical checkpoint
digest covering original criteria, requests used, ordered dockets, provenance,
excerpts and retrieval times. An explicit operator resume completed immediately
because the match target was already met. Counts stayed seven used/ledger
requests; no observations or source requests were duplicated. The older paused
eight-request job was also retained. This verifies application checkpoint
recovery, not interruption of a real in-flight court socket.

## Implemented controls

- Owner-scoped PostgreSQL jobs, events, request outcomes and ordered docket
  checkpoints; evidence saves deduplicate per owner and source entry.
- One worker in the existing API, a PostgreSQL advisory lease and a Python child.
  Every transmitted browser/source request needs a persisted parent grant.
  The HTTPS host/path allowlist blocks off-host/nonessential traffic before
  transmission. Service workers/background features are disabled.
- At least thirty seconds after the prior response completes; concurrency one; no automatic retries
  or followed redirects. Each actual attempt reserves a request slot, including
  failed requests. Requests uncertain after restart keep their consumed slots.
- Small initial job ceilings: five documents/twelve requests. Protected operator
  policy can permit up to 200 documents/500 requests. Slow jobs retain progress;
  original job budgets and filters never expand automatically.
- Pause/cancel preserve results. Restart pauses interrupted work for explicit
  resumption, with a short source cooldown for possibly in-flight traffic.
  Rate limits pause all jobs at least fifteen minutes and respect Retry-After.
  Access denial/challenge/redirect requires operator assessment.
- PDFs are held in memory, processed for identity and minimal bail evidence,
  and disposed on success or failure. Original source evidence is not overwritten.
  New saves remain PENDING/UNREVIEWED, without invented charge information.
- Local strict monetary-total-bail bounds and optional SHOWN_POSTED exclusion
  remain distinct from reviewed operative financial ranges. Unknown amounts
  are not zero; nominal/unsecured/nonmonetary categories stay separate.
- New jobs have a desired number of distinct matching dockets, fixed local
  collection filters, a separate processed-document cap and a request cap.
  A checkpoint after each document prevents speculative next downloads once
  the matching target is met. Nonmatches do not satisfy the target.
  Returned-page exhaustion or caps can leave the target unmet; the job never
  broadens its dates or follows remote pagination to manufacture more results.
  Display-only report filters cannot change an existing collection target.

Protected server settings and valid ranges are documented in `replit.md`.
Larger ceilings require an operator policy change plus a new explicit user
budget; changing policy does not enlarge old jobs. These controls are not
permission or a verified safe collection rate.

## Approved single-download assessment

The user approved one download using the earlier successful standard public
HTTP method. The API workflow was briefly stopped so the operator command could
take the application's same PostgreSQL worker lease. The command used the same
persisted request-grant function and spacing policy, with a single-use expected
counter of seven, and did not clear the ACCESS_DENIED source pause.

Request eight was one result-linked docket GET using Python's standard HTTP
client, the transparent CommunityBailResearch assessment User-Agent, no cookies,
no redirects, and no retries. It returned HTTP 200. PDF identity matched
`CP-02-CR-0005204-2026`; the five extracted bail entries agree with the earlier
source chronology above. PDF bytes were discarded. The minimal bail excerpt
and extraction evidence are now in the original discovery report, not the saved
record/review tables. Posted entries are NOT_SHOWN; custody remains unknown.

Counts immediately after the assessment: eight used/completed requests, one failed request, one discovered
and processed docket, zero extraction failures, zero unprocessed dockets.
The original five-document/twelve-request budget remains intact. No monetary
amount was demonstrated by that assessment. The job and source remained
PAUSED/ACCESS_DENIED after bringing the API workflow back up. Clearing the
source pause required the later, separate enablement approval.

The operator-only command is in
`artifacts/api-server/src/ujs/assess-download.ts`. It requires the job ID, the
expected consumed count, and `--approved-one-request`. It refuses to run while
the normal worker holds the lease, when the counter changes, or when the paused
source state is not an indefinite access denial. It is not an API endpoint or
a general collection-enabling switch. Every new assessment requires its own
explicit approval; do not rerun it under the earlier single-request approval.

The cause of the Playwright client's 403 remains unknown. Standard-client
success alone does not authorize broader collection or prove monetary extraction,
coverage, completeness, custody, or freshness. Monetary extraction was separately
demonstrated by the subsequent signed-in job above.

## Subsequent method approval and matching-target behavior

The user approved the successful method for bounded jobs and explicitly required
one-at-a-time downloads with a pause after each. They then clarified that the
target means matching dockets, not merely processed dockets. These requirements
are implemented with fixed job filters, deduplicated docket counts, a post-record
checkpoint and completion-anchored pacing through the existing shared limiter.
Historical criteria were not changed; old jobs remain processing-cap jobs.

Operator ceilings allow up to 200 processed documents/500 requests, but every
new job still defaults to 5/12 and requires explicit budgets. The completed check
continued only the blocked portions of the prior signed-in browser journey.
Further source denial stops collection; it is not grounds to change clients or
retry silently. The demonstrated method does not establish authorization, a
safe request rate, full court/window coverage, current custody or freshness.
Historical/MDJ/Preliminary Arraignment coverage and remote pagination remain
explicitly unsupported. No briefing rows, fixed-count guarantee or synthetic
records were used.
