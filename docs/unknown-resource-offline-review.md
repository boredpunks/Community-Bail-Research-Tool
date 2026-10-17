# Offline review: unknown calendar resource errors

Status update: the user subsequently authorized implementation and a fresh
bounded live execution. The diagnostic-only recommendations below are now
integrated in repair commit `a3b4c99`; see
[the execution ledger](bounded-engine-execution.md) for verification and run
outcomes. This review's authority/outcome section describes the earlier review
only, not current readiness or execution permission.

## Authority and outcome

The user authorized **review offline, with no court requests**. This review
inspected the retained sanitized diagnostic, classifier, route/error callbacks,
strict parent contract and existing tests. It changed no application code,
resource allowlist, classification exemption, validation gate, method version,
permit, source barrier or execution approval.

Twenty pure classifier probes used static non-case inputs, with TCP-connect
and DNS entry points guarded. They made zero network calls and launched no
browser. They demonstrate code behavior, **not reproduction or attribution of
the live errors**. The request ledger remains seven for the revised execution;
there are no queued/running jobs, active source request, access proof or
collection approval. The last source request began October 17, 2026 at
21:12:31 UTC. `SOURCE_VALIDATION_BARRIER` remains.

## Established facts and limits

The retained group is three observations of
`UNKNOWN_OR_UNSAFE / RESULT / OTHER / RESOURCE_LOAD_ERROR`.

- `RESOURCE_LOAD_ERROR` means the in-memory text matched a bounded
  resource-error-shaped signature. It does not establish a network failure's
  cause or even independently prove browser/network origin; application code
  can print matching console text.
- `OTHER` implies a nonempty bounded location string that did not exactly
  match a registered optional-abort URL or one of the recognized permitted
  calendar-resource aliases at classification time. It does **not** mean
  external, optional, harmless, required script, or validly parsed HTTP URL.
- Three grouped observations need not be three distinct resources. The group
  key has no per-request identity.
- `RESULT` is an application-stage label, **not proof of post-response timing**.
  It is set before `submit_calendar_search()`, which includes the protected
  wait before the Search POST can transmit. Events from the old document,
  transport wait, submitted response and passive inspection can share it.
- The response itself was independently observed after completion. Its
  expected-looking headers, one presentation row and zero recognized document
  links do not establish cases, empty results, source failure or error causality.
- Exact resource identities, network/status subtypes and event ordering were
  not retained and cannot be reconstructed from this envelope.

The fail-closed stop remains justified. None of these findings reclassifies the
three observations or authorizes accepting records, downloading PDFs or retrying.

## Information gaps confirmed in code and local probes

### 1. Permission checks are also being used as diagnostic location taxonomy

`resource_alias()` uses `source_protocol.allowed()` before naming the three
calendar resources. That is appropriate for transmission permission but too
coarse to explain a rejected/unmatched location.

Pure probes produced the same unknown/OTHER/resource-error group for:

- A known script path with an unrecognized query format.
- An unrecognized path on the court origin.
- A different HTTP origin.
- A non-HTTP location.
- A malformed location string.
- An optional-resource location that no longer exactly matched the full
  registered URL.

These are possibilities the implementation cannot distinguish, **not claims
about which one occurred live**. A missing location instead yielded UNKNOWN.
The supported script URL yielded the required-resource category.

### 2. Request-failure coverage is incomplete for diagnosis

`resource_failure()` records exact registered image/font/media aborts and
script/stylesheet failures. It omits unmatched image/font/media failures and
document/xhr/fetch/other failures. Local probes confirmed all these omissions.

Route counters retain an aggregate block count, plus required-script/style/data
counts; they do not retain a bounded per-request block reason or correlation
with console observations. Therefore three blocks and three console errors
cannot be assumed to describe the same events.

### 3. Failure subtype and event/request relationship are discarded

Network-error-shaped and HTTP-status-shaped console messages collapse to the
same signal. Console and requestfailed observations are separate counters and
can overlap. No request-start stage, current event stage, transport-progress
flags or request-local identifier is retained.

The exact optional exemption is intentionally narrow: a registered full URL
plus one of two demonstrated abort signatures. A different network code or an
HTTP error at the same registered URL remained non-exempt in local probes.
Do not broaden that rule to make the latest attempt pass.

## Recommended next change — diagnostics only, not implemented

Keep transmission permission checks and the fail-closed decision unchanged.
Extend only bounded, redacted metadata:

1. **Separate location class from request permission.** Fixed classes can
   distinguish a known calendar-asset path, other court-origin path, other HTTP
   origin, non-HTTP location, missing location and invalid/oversized location.
   Never retain a hostname, path, query, fragment, credential or console text.
   Recognizing a path for diagnosis must not make it permissible to fetch.
2. **Retain request-match and decision evidence.** Use a small, bounded
   in-memory registry with exact URL matching; emit only session-local ordinals,
   allowlisted resource types, fixed route decisions and
   unique/multiple/no-match/overflow states. Record requestfailed observations
   for all known resource types, including an UNKNOWN bucket. Do not emit URL
   hashes or normalize different URLs into a claimed exact optional match.
3. **Record lifecycle independently from phase.** Preserve fixed observations
   such as before POST attempt, POST attempt in progress, response acknowledged,
   browser fulfillment and read-only inspection; retain request-start and
   event-time states separately. A bounded local sequence can establish order
   without retaining source content. These are observed states, not causal proof.
4. **Retain a fixed failure subtype.** Recognize only explicitly defined network
   or HTTP-status classes, with OTHER/UNKNOWN fallback. A subtype is diagnostic
   evidence, never an exemption or source-origin assertion.

Keep all registries, groups, counters and ordering metadata bounded; distinguish
overflow from no match. Ambiguous matches remain unknown. Keep arbitrary strings
and case content out of both the child envelope and persisted parent events.
Do not add source requests, inspection modes, permit types or retries.

### Verification required before any future execution proposal

Add pure and loopback-only tests for all collapsed location classes, different
query formats, repeated/ambiguous exact matches, all request resource types,
errors before/during/after POST, optional aborts versus unrelated failures,
registry overflow and ordering bounds. Test secret/sentinel redaction and
strict parent rejection of extra/coerced/unbounded fields. Preserve packaging
smoke checks and frozen observation/INSPECT behavior.

Any eventual implementation must version the diagnostic contract and affected
calendar method fingerprints consistently. A completed offline patch or passing
fixture is not source access proof and does not authorize a live attempt.
The consumed failed permit and unused request balance remain unusable.
