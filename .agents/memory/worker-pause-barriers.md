---
name: Intentional worker stops
description: Distinguish pre-transmission scheduler denials and explicit pauses from source response validation failures.
---

A scheduler denial before transmission or an explicit user pause should pause
the job without creating a global `SOURCE_VALIDATION_BARRIER`. Preserve any
existing source-level block and the exact quota stop. A real source response or
validation failure remains fail-closed.

**Why:** An operator pause during calendar initialization was reported as an
unexpected source response even though the retained requests succeeded and no
Search POST began. The false global barrier then blocked recovery of the same
authorized job. That validation stop had also cleared the access-verification
fields; clearing only the barrier later did not restore them, so the document
stage correctly stopped at `ACCESS_UNVERIFIED`.

**How to apply:** Track parent denials separately from worker-observed response
failures. Accept only a bounded no-transmission pause message in the parent,
keep assessment-permit handling unchanged, and resume automatically only for
explicit hourly or daily quota pauses when the user has authorized continuation.
After clearing a false barrier, re-check access-proof state. Never recreate old
verification fields manually; require fresh, method-specific proof and
authorization before any new source request.
