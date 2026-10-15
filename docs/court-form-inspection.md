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
component updates, sync, and first-run behavior. The kernel boundary below is
independent of Playwright routing and applies before the worker starts.

- The inspection-only child is launched through `network_sandbox.py`. Before
  executing the worker, that wrapper closes inherited file descriptors above
  standard input/output/error, removes inherited HTTP/HTTPS/ALL/FTP/WebSocket
  proxy variables, verifies the exact runtime, and installs a Linux seccomp
  filter with `PR_SET_NO_NEW_PRIVS`. The filter permits only `AF_UNIX` socket
  creation for local browser/driver IPC; all other socket families are denied
  with `EPERM`. It also denies `io_uring_setup`, so the filter cannot be bypassed
  by creating sockets through io_uring. The kernel filter is inherited by the
  worker, Playwright driver, Chromium, and their descendants. If Linux,
  architecture support, `no_new_privs`, seccomp, or runtime checks are
  unavailable, the wrapper exits before the worker starts.
- Supported filter architectures are Linux x86_64 and aarch64. The verified
  workspace runtime is Python 3.13.11, Playwright 1.63.0, Chromium
  138.0.7204.100, and Node.js 24.13.0. The worker wrapper checks Python,
  Playwright, and Chromium against the first three exact versions before
  execution; a mismatch fails closed. Node.js is the parent process and its
  version is recorded but is not an egress enforcement layer.
- Chromium also receives `--no-proxy-server` and
  `--host-resolver-rules=MAP * ~NOTFOUND`. The latter prevents Chromium from
  resolving any hostname in this full-deny diagnostic mode. These are additional
  restrictions, not substitutes for seccomp.
- The sandbox test first confirms a controlled loopback HTTP canary works
  outside the child, then runs Chromium under the actual wrapper. It attempts
  HTTP including a redirect, WebSocket, iframe, preconnect, a hostname
  resolution path, direct IPv4/IPv6 TCP, and a UDP DNS-canary datagram while
  inherited proxy variables point at the canary. The attempts fail at the
  kernel boundary (`EPERM` for direct sockets); proxy variables are absent in
  the child; and the canary records no child HTTP or DNS traffic. The test uses
  only local endpoints and no court traffic.

This is a process-tree syscall boundary, not a separate network namespace or
host firewall. The current container rejects `unshare --net` with
`Operation not permitted`, so no network namespace guarantee is claimed.
`AF_UNIX` remains available for Chromium IPC. The filter prevents the worker
tree from creating IP sockets and the wrapper removes inherited proxy settings,
but it cannot prevent an independently running host service reachable over a
Unix socket from relaying a request on the worker's behalf. No such relay is
configured by this code; its absence must be verified in the deployed runtime.
This limitation, and the lack of deployed-host canary observation, mean the
local test is not evidence of deployed containment. Live `INSPECT` must remain
disabled until the deployed egress boundary and any host-mediated proxy or
resolver paths are independently verified.

- `MAX_RESPONSE_BYTES` is checked by the HTML asset-declaration parser after
  `response.body()` has read the complete response. It limits which HTML is
  parsed, not bytes transferred or buffered. Do not describe it as a transport
  response-size cap.

**Conditions before reconsidering the disabled flag:** keep `INSPECT` disabled
unless all of the following are completed and reviewed:

1. Attest the deployed Python, Playwright, Chromium, Linux architecture, and
   seccomp behavior; any mismatch must fail closed.
2. Demonstrate at the deployed enforcement point that no Unix-socket host
   service can relay requests, and repeat the local/canary bypass matrix under
   the actual worker launch path. If this cannot be proven, add a supported
   network namespace/host egress-deny layer or keep the stage disabled.
3. Bound response bytes while receiving them, before buffering the complete
   body, or explicitly accept and document a reviewed alternative. The current
   parser check alone is not a response-size bound.
4. Obtain a fresh independent enforcement review before changing the live flag.
   Even after that review, any live execution requires separate fresh explicit
   approval and a new one-use authorization; the review itself is not approval.

- Method identifier: `playwright-form-inspection-v2`. The operator `INSPECT`
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
matches for seven fixed public controls: search mode, judicial district, court
office, courtroom, start date, end date, and event type. For Courtroom, the
public label is compared to the intended criterion while its selected native
value is checked against FormData only in memory. The blank no-filter option is
represented by the application sentinel `ANY` and must be a unique, enabled,
empty option. No source option value is emitted. The October 15 offline fixture
uses the saved scope CP-05-02-Crim / Courtroom 506 / no event-type filter and
does not establish that the live form has those controls or bindings.

The snapshot does not inspect or retain field values, names, tokens, raw
content, screenshots, or console text. The parent accepts only one `BEFORE`
diagnostic phase and rejects additional phases or collection-result messages.
No click, `submit()`, `requestSubmit()`, native POST capture, Search submission,
result retrieval, or PDF retrieval is part of the inspection.

### Workspace enforcement probe (October 15, 2026)

The checked-out workspace could not create a network namespace:
`unshare -n true` failed with `Operation not permitted`. The process had no
`CAP_NET_ADMIN`; `ip`, `iptables`, and `nft` were unavailable. Replit
documentation searches returned no applicable per-process egress-control
guidance. The checked-in `.replit` targets Autoscale, but this local probe does
not establish what controls may be available to a separately configured
deployment. No deployment network policy or egress-enforcement point has been
verified.

The current `route.fetch` path also cannot bound bytes while receiving them.
The 4 MB check occurs only after the complete body is buffered. Playwright's
route fetch API used here returns a complete response, so checking its headers
or body afterward cannot prevent peak buffering.

**Recommended minimum alternative (not provisioned):** run only the inspector
in a dedicated isolated runner with default-deny network egress and a mandatory
streaming egress proxy. The runner must be unable to connect directly; the
proxy must allow only the approved destination and enforce a byte cap while
streaming. Keep the existing application request gate for method, path,
one-use budgets, and accounting. This requires separate compute/runtime setup,
proxy and firewall policy, pinned browser images, monitoring, and ongoing
security updates, with provider-specific recurring cost. No price or provider
has been selected. The user must approve that architecture and cost before
anything is provisioned. It does not itself authorize live inspection; the
separate review and fresh, exact execution approval remain required.

Historical `INSPECTED` reports refer to earlier, consumed executions. They are
not proof that the current offline safeguards have worked against the live
form, and do not enable source access or collection.

## Offline checks

`pnpm --filter @workspace/api-server run test:safety` exercises parent metadata
validation, scheduler admission in a disposable schema, Python request-gate
fixtures, and the seccomp/Chromium canary test. The local fixtures cover
allowed/denied requests, duplicate and concurrent attempts, declared-version
matching, redirects, retries, timeouts, uncertain persisted requests, the
session deadline, submission prevention, fixed runtime versions, the
worker-inherited network filter, proxy removal, and local TCP/UDP canaries. They
use no court traffic, case fixtures, or live form observations. These checks
verify this workspace only; they are not deployment/source proof.
