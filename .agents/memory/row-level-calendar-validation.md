---
name: Row-level calendar validation
description: Keep individual calendar data failures from becoming source-wide barriers.
---

A calendar row that fails item-level link, identity, scope, or date validation must be excluded without installing a source-wide validation barrier. Preserve other validated rows and mark coverage partial. If no rows validate, pause only that job; do not claim an empty search.

Keep source-wide barriers for transport or console failures, challenge/access denial, invalid response framing, form/criteria mismatch, and table/header layout changes.

**Why:** The user clarified that one nonconforming row should not stop the entire engine.

**How to apply:** Separate row-content validation from source-response integrity. Retain valid rows, report rejected-row counts and incomplete coverage, and keep global barriers for failures that undermine the response as a whole.
