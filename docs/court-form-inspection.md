# Operator-only public form inspection

## Authorization and outcome

The user separately approved one inspection for October 13–17, 2026, with a
three-GET total ceiling and no PDFs. The inspection started but was interrupted
after the initial request; its permit is now consumed and failed. Do not retry.
No court request is currently approved. A later, separately approved SINGLE
stage also failed and is documented in `court-access-pilot-results.md`; it did
not authorize further requests. The source-wide validation pause remains.

This tool diagnoses the public search form without changing the v6 PDF
validator, fetching a docket, saving candidates, or clearing the source pause.
Inspection is not SINGLE/SMALL/MODEST proof. It never records VERIFIED.
It is excluded from the public PDF-assessment stage list. The stored job
criteria use a record-cap placeholder of one to preserve the existing schema;
the actual inspection document/remote-POST caps are **zero**, enforced in both
the scheduler and child, and explicitly reported by the operator CLI.

Attempt: `8f3da183-2a1a-4398-8917-4ffd8646183d`; associated job:
`ef15662a-bed9-47b2-a16e-8973182da18e`. The proposal was user-approved, then
interrupted as the user questioned the future dates. Its start and completion
are recorded below.

The October 13–17 window was reused only because the earlier October 6–12
approval had gone stale. It never reached results or a PDF, so it established
nothing about either historical documents or upcoming hearings. The user has
clarified that research concerns people whose current incarceration is known
outside the court document: an earlier court PDF may show the original docket,
and a scheduled-hearing PDF is useful only if that PDF already shows bail
information. In either path the retrieved PDF must identify the docket and
include bail information; a hearing date alone proves neither. Court documents
do not establish current custody.

| Request | Outcome | Started (UTC) | Completed (UTC) | Duration |
| --- | --- | --- | --- | --- |
| GET `/CaseSearch` | HTTP 200 / OK | 2026-10-12 01:15:46.900 | 2026-10-12 01:15:48.163 | 1,263 ms |

No asset request, calendar Search POST, calendar candidate, PDF, or case record
followed. The process was interrupted before the inspection produced form
evidence. The total ceiling was three GETs, of which one was recorded; the two
unused slots are not authorization to continue. No source HTML, raw content,
tokens or credentials were retained.

After interruption, the runner process was gone. On managed API restart the
inspection was marked `FAILED`, with one successful request, zero valid
documents, and the request history retained. The job is paused, the source
still has `SOURCE_VALIDATION_BARRIER`, no request is active, and access
verification and collection approval remain unset.

## Later, separately approved read-only inspection

On October 12, 2026, the user separately approved a new inspection permit
`3c781bc3-1052-47af-8928-56713df3b5e4` for October 13–17, with no more than
three GETs, zero transmitted POSTs and zero PDFs. It was not a retry of the
earlier failed permit. Its complete request/timing ledger is in
`court-access-pilot-results.md`.

The integrated inspector passed its existing source-form minimum-date check
for the October 13 start date. It then recorded the bounded `BEFORE` and
`LOCAL_POST` metadata:

- All six expected public controls were present, enabled, in the same form and
  matched their scoped value.
- Each of the four selector widgets was unnamed and had one named text control
  inside its own widget container, associated with that same form. The value
  matched once in native form data and once in the locally captured submission.
- The two date controls were named date inputs; each same-form value matched
  once in native form data and once in the locally captured submission.

The retained `types.text` count represents the browser's normalized
`HTMLInputElement.type` property. The inspection did not retain whether the
original input explicitly had a `type` attribute. That distinction matters:
an input without the attribute defaults to `.type === "text"` but does not match
the CSS selector `[type="text"]`. The later v6 calendar attempt rejected these
widgets using that attribute selector; its read-only evidence and the v6
diagnostic are both retained in `court-access-pilot-results.md`. Do not infer
the original attribute presence from the earlier metadata.

The Search click was intercepted and aborted locally before transport. No
remote POST, calendar result, document or candidate was created. The permit
state is `INSPECTED`, not calendar/PDF access proof. The source-wide validation
pause and unset access/collection approvals remain unchanged; the permit is
consumed and authorizes no further source contact.

## Inspection-tool behavior (not authorization)

The existing operator CLI only accepts today/future dates of up to seven days.
That does not support historical search dates. The exact source support for
past-date records has not been established: the integrated client stops if the
source form's date minimum excludes the requested start date. Do not bypass the
form's minimum. Historical support needs offline investigation and a safe,
explicitly scoped implementation, followed by new user-approved dates and a
fresh permit before any source request. A future event window is not proof that
its PDF has bail information.

If the user later requests work on the native-form binding itself, present its
exact supported dates and request budget and obtain **separate approval for
that inspection**, not another PDF attempt:

- Method: `playwright-form-inspection-v1`.
- Maximum **three GET requests total**, including the initial `/CaseSearch`
  page and the two already-allowlisted script/style bundles. Their existing
  bounded version-query policy remains unchanged.
- **Zero transmitted POSTs, zero PDFs, zero docket/candidate records.**
- Same persisted limiter, rolling ceilings, 60–90-second response-completion
  pauses and longer adaptive waits as the integrated client.
- Roughly three minutes for three requests; longer adaptive waits may apply.
- Existing denial, challenge, redirect, throttle, timeout, uncertainty,
  latency, asset, script, public-value and budget barriers remain fail-closed.
  No retries, extra assets, date expansion or cap increases.

The usual `approve --id UUID --user-approved`, `run --id UUID --user-approved`
and `report --id UUID` commands apply. Build first, stop the managed API
worker before a separately approved run, and restart it afterward. Permits
expire after 24 hours and are consumed once. No public approval/run endpoint
or automatic scheduler path is added.

## What is observed

After the three bootstrap GETs, **all subsequent nonoptional browser requests
are intercepted and aborted**. Optional resources remain intentionally aborted.
Dependent-control network calls stop inspection rather than obtaining more
requests. The inspector fills the six known public controls and checks their
readback, native validity and exact POST target before Search.

The BEFORE observation counts named native control types in each known widget
container and at its explicit public ID; it also distinguishes eligible fields
outside the container. It checks same-form association and native FormData
matches. It does not globally search for a coincidental matching value.

Search may produce one native POST. That POST is **captured locally and aborted
before any transport call or scheduler reservation**. Only bounded,
URL-encoded bodies are processed transiently. Candidate field names stay in
child memory; token-like names, credential control types and unrelated field
values are not examined for matches. The LOCAL_POST observation counts exact
matches to the previously observed public native fields and, separately, to
known public property suffixes. A suffix match is **not binding proof**.
Unsupported body formats, missing submission or unexpected requests stop the
inspection. The browser is closed before reporting completion.

Retained evidence contains only six fixed public labels, booleans, bounded
type/count metadata, fixed phases and classified error counts, plus the
ordinary request/timing ledger. No HTML, screenshots, raw bodies, field names,
observed filter values, cookies, tokens or raw console text are retained.
Declared scope dates and criteria remain in the permit as required. The parent
rejects unexpected fields, invalid counts, duplicate/out-of-order phases and
collection-result messages.

`INSPECTED` means bounded observations completed with successful, paced,
accounted GETs and no documents. It does **not** mean native binding is resolved,
the server accepted a search, calendar results were validated, or PDF access
works. Existing access proof and source pause are not cleared; collection
approval remains unset. Failed/interrupted inspection permits are consumed,
with no automatic retry.

## Offline checks

`pnpm --filter @workspace/api-server run test:safety` checks parent metadata
validation and real PostgreSQL permit admission in a disposable schema.
Network-blocked Playwright fixtures exercise the actual Python worker with
fixture-only route responses, verify that only three GET fetch calls occur,
intercept the native POST, reject dependent-control requests, and confirm
redaction/body limits. Fixtures contain hypothetical **public form markup
only**, not docket/case records and not source proof.

Offline preparation checks passed: 124 safety checks, 19 Python tests, API
typecheck/build, Python compilation and whitespace checks. The attempted
inspection did not reach the form diagnostics; those offline checks are not
source proof.
