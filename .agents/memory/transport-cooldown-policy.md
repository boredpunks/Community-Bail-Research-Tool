---
name: Automatic source recovery
description: Cooldown-based resumption for recoverable source stops, while preserving access and uncertainty barriers.
---

Automatically resume the same eligible live search after a recorded shared-quota wait, source rate-limit cooldown (including `Retry-After`), HTTP 5xx backoff, conservative cooldown after sustained slow responses, or known timeout/network cooldown. Preserve the original scope and remaining request budget, and rerun all current source-admission checks before any request. A known timeout or network failure starts with a 15-minute shared source cooldown, doubled for each previous transport failure in the preceding 24 hours up to four hours. A 429 honors the longer of the source-directed wait and configured escalating throttle cooldown; sustained deterioration waits at least one hour and no less than current adaptive spacing.

An HTTP 5xx clears the current source access proof. Automatic recovery for that failure must use strict source admission even when the calendar is not yet validated; ordinary calendar admission alone can otherwise resume a search with missing proof. Keep it paused until current access proof and all other gates pass.

Access denials, challenges, login prompts, validation barriers, uncertain worker/restart outcomes, expired scopes, exhausted budgets, and local processing errors do not auto-resume. They require a specific human/source resolution or a new eligible search.

**Why:** The user asked that stops resume automatically after a safe cooldown that respects the site being searched. A 5xx clears source proof; a denial, challenge, or uncertain request is not a safe signal to retry, and expiry alone cannot reauthorize access.

**How to apply:** Require the latest request for the same job to match a known retryable outcome and require its recorded cooldown. Recheck the exact job, expiry, request budget, source admission, and access-proof gates before resuming. Never interpret a cooldown as permission to bypass a denial, challenge, or validation barrier.
