---
name: Paced collection at useful research scale
description: User's requirement to support slow automated runs instead of treating pacing as a permanent small-sample restriction.
---

Build around slow, resumable automation when source access requires pacing. The user wants to automate checking system data and is willing to wait to query a larger set, such as 200 dockets.

Run downloads one at a time, with a pause after each download finishes, rather than requiring the user to start each download separately.

**Why:** The user said, “The successful download method should be a continuous search that takes time to pause after each download so as not to trip the too many attempts error.”

**How to apply:** Continue within the explicitly selected date range and budgets, preserve progress when stopped, and do not promise that pacing prevents rate limits.

The requested target counts distinct dockets matching the selected bail filters, not all dockets processed. Keep processing and request safety caps separate.

**Why:** The user explicitly chose “Matching dockets” when asked which count should satisfy the search target.

**How to apply:** Fix the collection filters at job creation, count each docket once, continue past nonmatches, and disclose unmet targets when source results or budgets run out. Changing report display filters must not change an existing job.

**Why:** The user explicitly said, “if the search process requires a slow pacing in order to query, say, 200 dockets, then we should build around that.”

**How to apply:** Keep proof-of-access runs small, but do not confuse the diagnostic budget with the eventual research scale. Once access is demonstrated, preserve checkpoints and partial results across pauses and restarts. Larger budgets must remain explicit and operator-controlled. Pacing does not guarantee the source will avoid rate limits; pause rather than bypass them.

Prioritize anticipating rate-limit failures through a shared scheduler, persistent rolling budgets, response-aware pacing and slowdown, complete request accounting, deduplication, and durable source-wide stops. Validate these controls in bounded, approved stages before scaling.

**Why:** The user clarified that they want practical anticipatory measures, not a guarantee, then explicitly endorsed the proposed safeguards and requested a game plan.

**How to apply:** Treat initial pacing and quota values as proposed safeguards, not established court limits. Implementation approval does not authorize live verification requests or the larger research sample.
