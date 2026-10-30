---
name: Paced collection at useful research scale
description: User's requirement to support slow automated runs instead of treating pacing as a permanent small-sample restriction.
---

Build around slow, resumable automation when source access requires pacing. The user wants to automate checking system data and is willing to wait to query a larger set, such as 200 dockets.

Do not apply a local PDF-processing time slice to an active paced live search.

**Why:** Loading the real calendar and its required resources can consume several minutes under the protected response-completion pacing, before document processing starts. A local computation deadline would cancel valid source progress.

**How to apply:** Live searches obey source request budgets, pacing, server waits and genuine stop conditions independently of local extraction deadlines.

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

For UJS requests, use bounded 30–40-second pauses; the shared scheduler's higher adaptive delay always wins. This is an application setting, not a court-approved rate or guarantee.

**Why:** On 2026-10-30, the user asked to pick up the pace after a slow calendar response.

**How to apply:** Keep one request in flight and preserve rolling quotas, adaptive slowdowns, and stop conditions for denial, challenge, throttle, validation, uncertainty, timeout, or sustained latency deterioration. Do not automatically retry.

A successful HTTP response and extracted document do not prove pacing compliance. Audit each transmitted request against the current configured protected delay; per-path defaults must not bypass it.

**Why:** A live run retrieved and extracted a docket but used gaps shorter than its configured minimum, so the assessment correctly failed despite HTTP 200 responses.

**How to apply:** Stop after a failed pace audit, preserve the source-wide state and evidence, restore the current 50–70-second range before any future authorization, and do not repeat the source request without fresh approval.

A single slow-response warning is advisory for ordinary calendar searches when the scheduler has only increased adaptive spacing. Keep the slower shared pace; block only on an explicit sustained-deterioration stop or another real source barrier.

**Why:** On October 30, 2026, a 52-second calendar response produced a first-warning advisory, but admission incorrectly treated the warning as a hard lockout despite the scheduler reserving that stop for sustained deterioration.

**How to apply:** Do not use `latencyWarning` alone to disable ordinary calendar admission. Preserve `RESPONSE_DETERIORATION`, explicit cooldowns, quotas, access denials, challenges, and other actual stop reasons.
