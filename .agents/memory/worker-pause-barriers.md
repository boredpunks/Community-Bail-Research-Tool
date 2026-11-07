---
name: Intentional worker stops
description: Distinguish pre-transmission scheduler denials and explicit pauses from source response validation failures.
---

A scheduler denial before transmission or an explicit user pause should pause
the job without creating a global `SOURCE_VALIDATION_BARRIER`. Preserve any
existing source-level block and the exact quota stop. A real source response or
validation failure remains fail-closed. Recorded shared quota, rate-limit,
server-error, sustained-slow-response, TIMEOUT, and NETWORK_ERROR cooldowns may
auto-resume the same eligible search after fresh admission checks; uncertain
transport states remain manual.

**Why:** An operator pause during calendar initialization was reported as an
unexpected source response even though the retained requests succeeded and no
Search POST began. The false global barrier then blocked recovery of the same
authorized job. That validation stop had also cleared the access-verification
fields; clearing only the barrier later did not restore them, so the document
stage correctly stopped at `ACCESS_UNVERIFIED`.

**How to apply:** Track parent denials separately from worker-observed response
failures. Accept only a bounded no-transmission pause message in the parent,
keep assessment-permit handling unchanged, and auto-resume only explicitly
eligible timed source stops after their recorded cooldown. Denials, challenges,
validation barriers, and uncertain outcomes remain manual. After clearing a
false barrier, re-check access-proof state. Never recreate old verification
fields manually; require fresh, method-specific proof and authorization before
any new source request.

A parent stop after a successful document response controls future source
traffic, not local processing of the response already received. Extract and emit
that document before the worker reaches its checkpoint.

**Why:** A source-health stop can arrive after a PDF is successfully downloaded.
Discarding that body loses work without improving the stop's protection against
future requests.

**How to apply:** Preserve the current response for local extraction and
persistence, then honor the stop before any subsequent source transmission.
Keep retrieval and extraction outcomes distinct; do not add retries or bypass
the parent's request authorization.
