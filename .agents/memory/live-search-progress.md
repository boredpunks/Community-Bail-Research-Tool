---
name: Live search progress evidence
description: Keep live search progress grounded in validated stages and source-request accounting.
---

For live court searches, show the backend stage, request-slot usage, and an active request only when the source request is actually marked in flight. Label request usage as budget, not docket progress or completed transmissions; calendar assets consume that budget. Keep progress indeterminate until the calendar is validated, and never invent a result ETA.

**Why:** Calendar discovery can take time before any validated docket rows exist, and the request budget does not measure docket progress.

**How to apply:** Derive activity from structured server fields, keep source-request and document counts separate, and preserve the existing status polling path.

Resume availability must follow the same server-side source-admission decision as the resume endpoint. A future `nextEligibleAt` can reflect ordinary pacing or quota timing; it does not make an access denial, challenge, validation barrier, or uncertain request recoverable.

**Why:** A future source estimate previously allowed the UI to offer Resume while the actual server gate still rejected the request.

**How to apply:** Classify the admission result first, then expose a timed wait only for a recognized cooldown or quota block with a future release time. Keep the original scope and budget checks authoritative.
