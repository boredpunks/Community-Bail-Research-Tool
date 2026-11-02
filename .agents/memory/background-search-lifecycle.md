---
name: Background search lifecycle
description: Navigation independence, accurate completion status, and hosting limits for unattended searches.
---

Users must be able to click Search, navigate elsewhere, and return to docket numbers and bail information produced by the server-owned search.

**Why:** The user explicitly requested navigation without interfering with Search and expects extracted PDF evidence, not a page that must remain open.

**How to apply:** Never tie execution or cancellation to a mounted page, browser polling, or disconnected browser request. Restore the started search from server history after navigation. Browser selection is a preference, not authorization to resume or save.

Collection being finished is distinct from every financial observation being validated. A fully traversed, completed source job with locally processed PDFs may finish with explicit review warnings; ambiguous text must not fabricate amounts or masquerade as an unfinished network request.

**Why:** One ambiguous PDF made a finished search appear paused even though all PDFs had been retrieved. Other extracted PDFs legitimately recorded bail denied, which blank amount cells failed to explain.

**How to apply:** Retain usable results, show denied/nonmonetary states explicitly, and leave unknown amounts unestablished. Never clear genuine source barriers, missing requests, or incomplete pagination merely to show completion.

Always-on unattended execution needs an always-on worker host.

**Why:** Autoscale can scale to zero without HTTP traffic; frontend independence alone cannot guarantee execution after all visitors leave.

**How to apply:** Distinguish in-app navigation from leaving the app entirely. Explain ongoing compute costs and obtain approval before changing hosting.

The user wants to keep the current hosting and have it last until a search is complete.

**Why:** The user specified, “Current hosting that lasts until search is complete,” rather than approving an always-on hosting change.

**How to apply:** Preserve the hosting choice. Do not claim Autoscale has a supported background-job completion lease; distinguish the requested behavior from what the current platform guarantees.

A server restart, including a republish, ends the court browser session. A search stopped in the PDF stage cannot use its remaining document links afterward and needs a new search.

**Why:** On 2026-11-02 a quota-paused search was resumed after an API restart and paused 13 seconds later with the session-ended message, without sending a court request.

**How to apply:** Do not promise that PDF-stage searches continue across restarts or idle shutdowns; restart-continuation tests should expect this stop for PDF-stage work.
