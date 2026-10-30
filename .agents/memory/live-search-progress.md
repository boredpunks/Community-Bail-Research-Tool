---
name: Live search progress evidence
description: Keep live search progress grounded in validated stages and source-request accounting.
---

For live court searches, show the backend stage, request-slot usage, and an active request only when the source request is actually marked in flight. Label request usage as budget, not docket progress or completed transmissions; calendar assets consume that budget. Keep progress indeterminate until the calendar is validated, and never invent a result ETA.

**Why:** Calendar discovery can take time before any validated docket rows exist, and the request budget does not measure docket progress.

**How to apply:** Derive activity from structured server fields, keep source-request and document counts separate, and preserve the existing status polling path.
