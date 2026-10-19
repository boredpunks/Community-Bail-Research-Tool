---
name: Single-attempt execution ownership
description: Avoid competing live source attempts when task agents and the main workspace have separate execution records.
---

Establish one execution owner before consuming a bounded source authorization.
An in-progress task label alone does not prove an active executor, a launch,
or transmitted traffic. Distinguish unstarted, claimed, requests transmitted,
Search submitted, and finished.

**Why:** The user explicitly required ownership resolution from task and
execution evidence, not repeated unchanged-scope approval questions.

**How to apply:** If another executor is active on the exact attempt, leave
execution with it and do independent offline work. Do not cancel an active
source operation to transfer ownership. Use the existing atomic launch/job
claim mechanism. A failed worker does not prove nothing was transmitted, and
coordination or ownership transfer never grants another attempt.

When an isolated executor's ledger cannot be inspected, say exactly which
records are unavailable. A main-workspace ledger does not establish the
isolated executor's transmission count. Ask the user only to designate the
execution owner; do not ask them to reapprove the unchanged source scope.

**Why:** The user explicitly allowed this narrow ownership question when
inspection or coordination is unavailable.

**How to apply:** Never infer an unused authorization from a stale task label
or an unchanged ledger in a different environment. Preserve known request
history and require fresh authorization before repeating a transmitted
failed attempt.
