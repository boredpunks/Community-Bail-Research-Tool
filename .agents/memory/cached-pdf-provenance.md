---
name: Cached PDF provenance
description: Provenance rules for evidence verified from a locally cached court PDF.
---

For cached PDFs, preserve the original retrieval time as unknown/null unless it was independently recorded. Store a separate local consultation time, and retain the digest, source identity, page count, and page/quote evidence. Revalidate those links before sharing; malformed or ambiguous evidence must remain blocked.

**Why:** A local inspection proves what the volunteer consulted, not when the source PDF was originally retrieved.

**How to apply:** Keep cache consultation and original retrieval as separate fields throughout extraction, saved review evidence, exports, and UI labels.
