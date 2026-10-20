---
name: Scoped size-limit recovery
description: Preserve global source and document stops when a bounded calendar response limit has a narrowly proven calendar-only recovery path.
---

Permit only a new, user-initiated calendar operation when the retained latest source request proves a completed successful Calendar Event HTML response hit the superseded limit. Keep the recorded source barrier and failed job history unchanged; document retrieval and general collection remain stopped. Cooldowns, in-flight checks, pacing, and job caps still apply.

**Why:** a shared small HTML limit blocked supported result pages, but deleting the block would also reopen unrelated source and document operations.

**How to apply:** when revising response-size policy, verify request provenance at admission time and grant only the specific operation; never silently reset the source state or make the exception reusable for downloads.
