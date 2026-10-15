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
stylesheet URLs must exactly match declarations in the bounded bootstrap HTML;
an optional `v` query is accepted only as one bounded version hash and only
when that exact URL was declared. Redirect following and retries are disabled,
and each fetch is limited to 45 seconds.

For a future reviewed implementation, Playwright's context route is installed
before the first page navigation, applies to context pages/frames and their
HTTP(S) requests, and is backed by the parent scheduler's persisted request
budget and duplicate-path check. Service workers are blocked, browser background
networking is disabled, and a context WebSocket route closes WebSocket
connections before page creation. Non-allowlisted resource types and later
page requests are aborted. Local tests exercise the request gate and fixed
fetch options only; they are not proof that the live form works.

**Remaining enforcement limitation:** these controls do not establish control
over every Chromium, operating-system, DNS, preconnect, or platform-proxy
side-channel. Nor do local fixtures prove the deployed browser/runtime has
identical interception semantics. Therefore `INSPECT` must remain disabled
until a separate review establishes whether those residual channels are
acceptable and verifies the actual runtime's interception coverage. Any future
live execution still requires fresh, explicit approval and a new one-use
authorization.

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
