# Parent HTTPS broker: operator-workspace review

## Scope and result

The operator-controlled workspace is the first inspection-readiness review
target. This revises the earlier requirement that even the first review had
to wait for a deployment. It does **not** remove the separate gate for any
future deployed execution.

The broker fits the existing single Node-parent/Python-child design and has
been wired into that private pipe. It is dormant: `formInspectionLiveEnabled`
is still `false`, the Python worker still returns
`FORM_INSPECTION_LIVE_DISABLED` before Playwright starts, and the persisted
scheduler still rejects live `INSPECT` admission.

No court request or court DNS lookup, live permit creation, deployment,
collection approval, source-pause clearing, or Docker/Replit service-socket
connection was part of this work. Safety-test assessment rows exist only in
the disposable test schema; they are not operator authorizations.

## Implementation-backed request flow

1. `discovery-worker.ts` chooses the inspection sandbox wrapper only for the
   exact current inspection method. Old inspection methods are rejected,
   rather than being launched as collection. The new identity is
   `parent-https+playwright-form-inspection-v3`; it is not inherited proof from
   the earlier Chromium-network client.
2. Behind the unchanged disabled barrier, `InspectionRequestRouter` pauses
   requests at CDP's **Request** stage. It never calls `continueRequest`,
   `route.continue_`, or browser `route.fetch` for inspection. Service workers
   and WebSockets remain blocked.
3. The child gate reserves only one bootstrap `GET /CaseSearch` and at most
   one GET each for the fixed script and stylesheet. Asset URLs, including
   their exact bounded version query, must have been declared in the received
   bootstrap document. POSTs, PDFs, arbitrary fetches, other origins/paths,
   extra query keys, and repeated paths are rejected.
4. The child sends URL, path, method, resource type, and actual browser headers
   over stdout. `InspectionFetchBroker` independently validates their exact
   shape, destination, method, path/type, query, declared asset version, header
   bounds, one-use path, and monotonic ten-minute session deadline. It rejects
   concurrency while a fetch or its accounting is outstanding.
5. Before DNS or HTTPS, the parent calls the existing persisted scheduler.
   That scheduler checks job/permit state, scope, expiry, approval, source
   cooldown and uncertainty, global/job budgets, prior paths, and pacing under
   its locks. The unchanged disabled flag denies real inspection reservations.
   A reservation failure causes no transport call. Failure after reservation
   consumes that slot; it does not authorize replay.
6. The parent resolves only the fixed host's public IPv4 addresses, rejects
   private/reserved answers, pins the selected address, and makes a single
   certificate-verified HTTPS GET with the fixed hostname/SNI on port 443.
   No redirect following, HTTP retry, proxy socket, or alternative destination
   is configured. DNS plus headers/body share a maximum 45-second deadline,
   further limited by the remaining session time.
7. The parent streams the body and stops at the first byte exceeding
   **4,000,000 bytes**, or rejects an advertised larger body before reading.
   It preserves ordered raw header pairs, including duplicate `Set-Cookie`,
   and transfers the bounded bytes as base64. Compression other than identity,
   trailers, protocol upgrades, ambiguous lengths, non-ASCII header values,
   and unsupported connection-nominated headers fail closed rather than
   silently changing required browser state.
8. The child bounds the protocol line to 6,000,000 characters, rejects EOF,
   truncation, malformed response shapes, invalid base64 and oversized decoded
   bodies, and classifies the response. The parent independently binds the
   accounting reply to its outstanding request ID, actual status, classification,
   and Retry-After before applying persisted source accounting. Mismatches and
   replay stop the worker; unfinished reservations retain uncertainty handling.
9. Only after the accounting acknowledgement may CDP fulfill the request.
   Duplicate cookies remain separate response headers and Chromium retains its
   own cookie/session state. Actual cookies from subsequent browser requests
   are forwarded to the parent, not invented or persisted. Transport framing
   headers are removed and Content-Length is recomputed for the exact bytes.
   Denial or stop means abort, not external browser networking.

Raw source bodies, cookies, tokens and console text remain ephemeral. Broker
errors return bounded category codes, not transport error text. Metadata-only
inspection output, zero Search/POST/PDF behavior, the source barrier and all
separate execution approvals remain unchanged.

## Host Unix-socket boundary

Read-only metadata inspection found writable Docker/Replit service-socket
paths for the workspace user. Their permissions prove neither relay behavior
nor its absence. None was opened, connected to, queried, or used as a network
workaround.

The previous filter allowed every AF_UNIX socket. That was insufficient for
excluding named host relays. Local synthetic tests also showed that an AF_UNIX
datagram **socket pair** can send to a third named endpoint via `sendto` or
`sendmsg`, even without `connect()`.

The revised inherited filter therefore:

- rejects all non-Unix socket creation and all `connect()` calls;
- rejects Unix datagram sockets and datagram pairs;
- permits only Unix stream/seqpacket sockets and pairs for local IPC;
- still rejects io_uring setup and closes inherited descriptors above 2.

Blocking every `socket()` call was tested and rejected: pinned Chromium needs
a local stream listener for its unique profile singleton. The narrower rule
allows that listener without allowing an outbound connect. Fixed-peer stream
IPC remains operational. The local Unix canary receives no traffic; attempts
to create datagram relay channels or connect to a named endpoint get `EPERM`.
A controlled attempt to reopen a parent-owned test socket through `/proc`
failed with `ENXIO`; this was not a host-service probe.

These are specific syscall/channel observations, not a claim of complete
hostile-process isolation, protection from arbitrary same-user process control,
or absence of every possible descriptor-transfer channel. The environment
cannot create a separate network namespace. Independent review must decide
whether the intended threat model requires a stronger supported user/process/
filesystem/network boundary. Live inspection remains disabled regardless.

## Verification and limits

The offline suite exercises allowed/denied requests, exact declared asset
versions, reservation denial before transport, concurrency, one-use replay,
response boundaries, interrupted/timeout outcomes, session deadlines, malformed
messages, accounting mismatch, and redacted diagnostics. PostgreSQL scheduler
tests use a disposable schema. Real local Chromium tests verify request-stage
fulfillment, separate response cookies and their later request headers. The
actual sandbox wrapper is tested with local TCP, UDP/DNS and Unix canaries.

Validation on October 16, 2026 included the working-tree changes on checkout
`13bf7f0b1df1cb8649d1562a58a633a60580ff7e`:

- `pnpm --filter @workspace/api-server run test:safety`: passed the broker
  fixtures, 446 existing offline checks, and all 61 Python tests.
- API TypeScript checking, API build, Python compilation and
  `git diff --check`: passed.
- Only the managed API workflow was restarted. Startup was clean and the
  proxied `/api/healthz` endpoint returned HTTP 200 with `{"status":"ok"}`.
- Runtime: Node.js 24.13.0; the sandbox suite verified its pinned Python
  3.13.11, Playwright 1.63.0 and Chromium 138.0.7204.100.

The parent decision/stream tests inject an in-memory transport. They do not yet
exercise the default HTTPS transport against a controlled TLS server. Real
Chromium interception/cookie tests are separate from those parent fixtures.
Controlled TLS-wire tests and independent enforcement review remain useful
additional checks; neither is replaced by the passing suite.

The production HTTPS transport's compatibility with the **court source** is
deliberately unverified. Node's HTTP/TLS client is not Chromium's TLS client;
offline fixtures do not prove the source accepts its handshake, HTTP version,
identity encoding, headers, cookies or session behavior. Unsupported behavior
must stop without retries, alternate clients, invented state or workarounds.

The disabled production worker is not bypassed to run a full live inspection.
Passing local checks is evidence for this workspace review, not authorization
to enable the flag, contact the source, prepare a permit or collect records.

### Separate future deployed-readiness gate

Any future deployed execution requires fresh environment-specific runtime
attestation, proof of the inherited filter and permitted IPC, controlled
canary observation, host-relay/descriptor-channel assessment, parent-broker
verification, and an independent enforcement review. Do not substitute
workspace results. Changing the disabled flag and any exact one-use source
execution each still require their own explicit approval.
