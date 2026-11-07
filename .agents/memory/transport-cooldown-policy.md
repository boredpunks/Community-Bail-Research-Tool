---
name: Automatic source recovery
description: Cooldown-based resumption for recoverable source stops, while preserving access and uncertainty barriers.
---

Automatically resume eligible live searches after recorded shared-quota waits, source rate-limit cooldowns, HTTP 5xx backoff, sustained slow responses, and known timeout/network cooldowns. Also automatically retry app-local processing failures, saved-evidence processing failures, processing-slice stops, and interrupted app restarts with exponential backoff capped at one minute. Preserve original scope and remaining request budget; rerun all current source-admission checks before any live request. A known timeout or network failure starts with a 15-minute shared source cooldown, doubled for each previous transport failure in the preceding 24 hours up to four hours. A 429 honors the longer of the source-directed wait and configured escalating throttle cooldown; sustained deterioration waits at least one hour and no less than current adaptive spacing.

An HTTP 5xx clears the current source access proof. Automatic recovery for that failure must use strict source admission even when the calendar is not yet validated; ordinary calendar admission alone can otherwise resume a search with missing proof. Keep it paused until current access proof and all other gates pass.

Access denials, challenges, login prompts, validation barriers, and uncertain source-request outcomes remain blocked until the external/source condition is resolved. Expired scopes, missing source jobs, and exhausted request budgets cannot resume; they require a new eligible search. App-local processing failures do auto-resume, but a live retry stops if fresh source admission finds an external blocker.

**Why:** The user asked for app-internal interruptions to auto-resume without unnecessary eligibility restrictions. External access barriers and uncertain source requests still need resolution, and automatic retries must not widen scope or bypass the court's limits.

**How to apply:** Mark app-local failures for prompt exponential-backoff retry, including saved-evidence processing that makes no court requests. Before every live retry, recheck the same job, original dates, remaining budget, source admission, and access proof. Never retry through a denial, challenge, login prompt, validation barrier, or uncertain in-flight source request.
