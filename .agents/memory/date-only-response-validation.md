---
name: Date-only response validation
description: Preserve calendar dates when validating responses with generated Zod schemas.
---

Validate response payloads with the generated schemas, but do not substitute their coerced output when the contract contains date-only strings.

**Why:** The generated Zod schemas coerce both date-time and date-only fields to Date. Serializing that coerced output turns a calendar date into an ISO timestamp, which no longer matches the date-only contract.

**How to apply:** Keep order dates in YYYY-MM-DD form. Response validation should check the original serialized payload and then send that payload unchanged. Source timestamps remain timezone-aware ISO instants.

Test calendar-date normalization across the Python-to-TypeScript boundary,
including dates after the first day of a multi-day window.

**Why:** Form-selection and header-only checks cannot detect a parser that
validates a displayed date but transmits the original display text, or a
parent that accepts only the window's first day.

**How to apply:** Exercise the real parser's date-only projection through the
parent's date guard. Use date cells without docket identities or case records,
preserving the no-fabricated-records rule, and test both inclusive boundaries.
