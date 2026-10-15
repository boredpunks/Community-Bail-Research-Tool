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

## Offline safeguards after the October 15, 2026 approval

No live inspection was run while implementing these changes. The current
`INSPECT` stage is deliberately disabled in the operator CLI, scheduler, and
Python worker; no new authorization was created or consumed.

The inspection path no longer clicks Search or captures a locally aborted
submission. It emits only the pre-submission public-form snapshot. The offline
request gate reserves a path before fetch, permits at most one GET for each of
`/CaseSearch`, `/resource/js/sitemain.min.js`, and
`/resource/css/sitemain.min.css`, and caps the session at three reservations
and ten minutes. Failed and timed-out fetches remain reserved. Script and
stylesheet URLs must exactly match declarations in bootstrap HTML accepted by
the asset parser's 4 MB limit. That parser limit is not an upstream body-size
limit; see the browser-boundary review below.
an optional `v` query is accepted only as one bounded version hash and only
when that exact URL was declared. Redirect following and retries are disabled,
and each fetch is limited to 45 seconds.

### Browser and runtime boundary review

The live-disabled barrier remains in force. The TypeScript flag is `false`, the
operator CLI refuses to prepare `INSPECT`, the scheduler denies it before
reserving a source request, and the Python worker exits before starting
Playwright. Thus the context routes below are currently unreachable for live
`INSPECT`; their presence is not an enabled or source-tested boundary.

In the dormant browser path, the context HTTP route is installed before the
first navigation. It reserves each accepted request through the fixed gate
before `route.fetch`, which is configured without redirect following or retries
and with a timeout. The request gate allows only the bootstrap document and
exact script/stylesheet URLs declared by that document. The context blocks
service workers, and the browser launch disables background networking,
component updates, sync, and first-run behavior. If the Playwright context does
not expose `route_web_socket`, the worker fails closed; otherwise its
context-wide WebSocket handler closes connections and is installed before page
creation. These controls cover the relevant Playwright-routed HTTP requests and
WebSocket connections, not all traffic originating from Chromium or its host.

There are important limits to the available evidence and controls:

- The repo does not pin or attest the Playwright package and Chromium executable
  used by the deployed worker, nor establish that deployed runtime's API
  versions or interception behavior. In this workspace only, Playwright 1.63.0
  and Chromium 138.0.7204.100 were observed; this is not evidence about
  deployment.
- The launch flags are not an OS-level network policy. There is no explicit
  browser proxy or worker egress-deny policy in this code. Chromium, its network
  service, the host OS, DNS resolver, or platform proxy could have paths outside
  the page request handler, including DNS activity, preconnect/speculation,
  browser-originated ancillary traffic, or direct UDP/WebRTC. Disabling selected
  background features does not prove those paths are closed.
- Playwright routing and WebSocket interception do not prove that every browser
  protocol or process-level connection is mediated. Service-worker blocking
  removes that interception bypass class but is not a general network sandbox.
- `MAX_RESPONSE_BYTES` is checked by the HTML asset-declaration parser after
  `response.body()` has read the complete response. It limits which HTML is
  parsed, not bytes transferred or buffered. Do not describe it as a transport
  response-size cap.
- Existing offline tests cover the request gate, fixed fetch options, and the
  worker's disabled barrier. They do not exercise deployed browser packet
  egress, DNS/proxy behavior, or every Chromium protocol. They neither establish
  complete containment nor prove live source behavior.

**Conditions before reconsidering the disabled flag:** keep `INSPECT` disabled
unless all of the following are completed and reviewed:

1. Identify and pin/attest the Playwright version, Chromium binary/version, and
   runtime configuration actually used by the deployed worker. Verify the
   required context HTTP and WebSocket interception APIs are available; any
   mismatch must fail closed.
2. Enforce default-deny egress outside Chromium for the worker's process or
   isolated runtime. Prevent direct network access that bypasses the enforcement
   point, explicitly constrain DNS and proxy use, and account for TCP, UDP, and
   browser ancillary protocols. The enforcement must be strong enough to
   prevent unapproved destinations and, if it cannot guarantee the intended
   request method/path limits, the live flag must remain disabled.
3. Prove the deployed boundary with controlled local or canary endpoints and
   observation at the egress enforcement point. Cover ordinary HTTP, redirects,
   WebSockets, service workers, frames/popups, DNS/preconnect/speculation,
   proxy inheritance, and direct UDP/WebRTC attempts; demonstrate that denied
   attempts do not leave the isolated worker. Do not use the court source for
   these tests.
4. Bound response bytes while receiving them, before buffering the complete
   body, or explicitly accept and document a reviewed alternative. The current
   parser check alone is not a response-size bound.
5. Obtain a fresh independent enforcement review before changing the live flag.
   Even after that review, any live execution requires separate fresh explicit
   approval and a new one-use authorization; the review itself is not approval.

- Method identifier: `playwright-form-inspection-v1`. The operator `INSPECT`
  stage is currently disabled; its old prepare/approve/run flow must not be
  used. This is a safety hold, not live authorization.
- A future reviewed path is limited to three GETs total (bootstrap page plus
  only its declared script and stylesheet), one GET per path, zero POSTs,
  zero PDFs, and zero docket/candidate records. Failed/uncertain transmissions
  consume their persisted request slots.
- The session shares the persisted source limiter and conservative pacing.
  Fetches have no retries or redirect following, a 45-second timeout, and a
  ten-minute total deadline. Date expansion and cap increases are not allowed.

The read-only snapshot counts bounded control types and same-form/FormData
matches for six fixed public controls. It does not inspect or retain field
values, names, tokens, raw content, screenshots, or console text. The parent
accepts only one `BEFORE` diagnostic phase and rejects additional phases or
collection-result messages. No click, `submit()`, `requestSubmit()`, native
POST capture, Search submission, result retrieval, or PDF retrieval is part of
the inspection.

Historical `INSPECTED` reports refer to earlier, consumed executions. They are
not proof that the current offline safeguards have worked against the live
form, and do not enable source access or collection.

## Offline checks

`pnpm --filter @workspace/api-server run test:safety` exercises parent metadata
validation, scheduler admission in a disposable schema, and Python request-gate
fixtures. The local fixtures cover allowed/denied requests, duplicate and
concurrent attempts, declared-version matching, redirects, retries, timeouts,
uncertain persisted requests, the session deadline, submission prevention, and
diagnostic-contract acceptance. They use no court traffic, case fixtures, or
live form observations. These checks are not source proof.
