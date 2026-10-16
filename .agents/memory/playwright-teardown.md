---
name: Playwright teardown warnings
description: Pinned Python Playwright can emit unhandled Response.finished task errors after successful offline assertions.
---

The pinned Python Playwright 1.63.0 can emit unhandled `Target closed` errors
from internal `Response.finished` tasks during context/browser teardown, even
when the surrounding fixture's assertions succeed. Do not equate passing
unittest assertions with clean asynchronous shutdown.

**Why:** Local offline runs showed these internal task errors alongside
successful parser/cache and timeout-classification assertions.

**How to apply:** Check stderr for unhandled task exceptions as well as the
test result. Resolve and verify lifecycle behavior rather than suppressing
warnings or calling the run clean. This observation does not establish the
cause of any historical source failure.
