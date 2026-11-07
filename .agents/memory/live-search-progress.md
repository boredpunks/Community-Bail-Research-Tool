---
name: Live search progress evidence
description: Keep live search progress grounded in validated stages and source-request accounting.
---

For live court searches, show the backend stage, request-slot usage, and an active request only when the source request is actually marked in flight. Label request usage as budget, not docket progress or completed transmissions; calendar assets consume that budget. Keep progress indeterminate until the calendar is validated, and never invent a result ETA.

**Why:** Calendar discovery can take time before any validated docket rows exist, and the request budget does not measure docket progress.

**How to apply:** Derive activity from structured server fields, keep source-request and document counts separate, and preserve the existing status polling path.

Resume availability must follow the same server-side source-admission decision as the resume endpoint. A future `nextEligibleAt` can reflect ordinary pacing, quota timing, or the explicit transport-failure cooldown; it does not make an access denial, challenge, validation barrier, or unresolved uncertainty recoverable.

Known timeouts and network failures may automatically continue the same eligible search after their recorded cooldown; restart/worker uncertainty and access barriers remain non-automatic.

**Why:** The user requested automatic continuation after a safe cooldown for known failed requests; a future source estimate still must not bypass the actual server gate.

**How to apply:** Classify the admission result first and expose only verified waits. Auto-resume only known TIMEOUT or NETWORK_ERROR jobs after their recorded cooldown, rechecking source admission, access proof, expiry, scope, and budget. Uncertainty, denials, challenges, and validation barriers do not auto-resume.
