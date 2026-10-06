---
name: No fabricated docket or case records
description: Project rule prohibiting synthetic docket and case records in every environment.
---

Never create or use synthetic docket or case records in this product, including demo data, previews, screenshots, seeds, or fixtures. The interface must support a genuinely empty research set until real, source-verifiable records are entered or imported and reviewed.

**Why:** The user explicitly stated, “No synthetic dockets ever.”

**How to apply:** Do not seed made-up docket identifiers or case facts. Ensure summaries and ranges only derive from real records with evidence and the required review state. Keep test inputs non-case-like and never present them as records.

Official UJS search forms and help text can contain illustrative docket identifiers. Do not count whole-page regex matches as discovered cases.

**Why:** A source-assessment response returned the search form, whose embedded help example produced a false-positive docket match even though no search-result rows had been demonstrated.

**How to apply:** Extract identifiers only from a validated result structure, and validate retrieved docket-document identity separately. A returned form is neither a completed search nor proof of an empty result set.
