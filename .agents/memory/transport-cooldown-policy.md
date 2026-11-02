---
name: Transport-failure cooldown
description: Live-source timeouts and uncertain transport stop the current search but do not create a permanent global lockout.
---

A timeout, lost connection, stale in-flight request, or interrupted request stops its current job and never retries automatically. It imposes a 15-minute shared source cooldown, doubled for each previous transport failure in the preceding 24 hours up to four hours. After expiry, a later user action may start a new search or explicitly resume the same eligible paused search.

**Why:** The user explicitly changed the earlier permanent-stop rule after the published app became unusable from one recorded court timeout.

**How to apply:** Keep denials, challenges, validation barriers, sustained deterioration, quota rules, and request budgets unchanged. For a legacy transport stop with no stored expiry, derive its deadline from the matching source request record; if no matching record exists, fail closed. An expired cooldown does not establish access proof; the first eligible PDF still needs its ordinary response-based proof check.
