---
name: Pinned Playwright response completion
description: Response.finished leaves a target-close task pending; use a pre-registered public completion event on the pinned version.
---

Avoid `Response.finished()` on the pinned Python Playwright 1.63.0 when a
public, pre-registered request-completion event can establish the same boundary.
Do not equate passing assertions with clean asynchronous shutdown.

**Why:** The installed library starts a target-close task and does not cancel
it when response completion wins. This emitted unhandled `Target closed`
errors on teardown even after successful assertions. Public completion-event
waiters avoided that behavior in the offline checks.

**How to apply:** Register the public event before triggering the request to
avoid a fast-response race; bind completion to the intended request. Check
stderr and unhandled-task assertions, not just the final test status. Do not
suppress warnings or patch library internals. Recheck the library behavior on
upgrade rather than assuming the limitation is permanent. This does not
establish the cause of any historical source failure.
