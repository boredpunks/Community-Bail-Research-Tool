---
name: First-PDF barrier recovery
description: Safe recovery from a persisted source-validation barrier after an ordinary live calendar search.
---

A persisted `SOURCE_VALIDATION_BARRIER` must not globally enable PDF collection. A new authenticated live search may clear only that barrier when it reaches the one-use first-PDF check: validated calendar results, a linked live bail search, the first supported pending item, exactly one Search POST, no earlier PDF request, and no active request or cooldown.

**Why:** A validated calendar can be available while an older source-wide barrier still prevents the document-access check. Clearing the barrier broadly would bypass document safeguards.

**How to apply:** Keep access unverified until the first PDF returns successfully and its docket identity is validated. Audit the narrow barrier clearing; retain denial, challenge, rate-limit, transport, cooldown, and sustained-deterioration stops.
