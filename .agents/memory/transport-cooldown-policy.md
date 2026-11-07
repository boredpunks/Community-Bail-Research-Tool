---
name: Transport-failure cooldown
description: Live-source timeouts and uncertain transport stop the current search but do not create a permanent global lockout.
---

A known timeout or network failure stops its current job and imposes a 15-minute shared source cooldown, doubled for each previous transport failure in the preceding 24 hours up to four hours. The same eligible live search may automatically resume as soon as that cooldown and all current source-admission checks clear, using only its original scope and remaining budget. Uncertain requests after restart or worker loss remain manual because their outcome cannot be established.

**Why:** After a known failure, the user asked for searches to resume automatically after a safe cooldown; uncertain outcomes and source barriers still need stricter handling.

**How to apply:** Auto-continue only when the latest request for that same job matches TIMEOUT or NETWORK_ERROR and a cooldown can be derived from source state or its matching request. Recheck the exact job, expiry, request budget, admission, and access-proof gates before resuming. Do not auto-resume rate limits, denials, challenges, validation barriers, restart/worker uncertainty, sustained deterioration, or unverified legacy stops.
