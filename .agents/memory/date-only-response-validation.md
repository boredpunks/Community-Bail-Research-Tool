---
name: Date-only response validation
description: Preserve calendar dates when validating responses with generated Zod schemas.
---

Validate response payloads with the generated schemas, but do not substitute their coerced output when the contract contains date-only strings.

**Why:** The generated Zod schemas coerce both date-time and date-only fields to Date. Serializing that coerced output turns a calendar date into an ISO timestamp, which no longer matches the date-only contract.

**How to apply:** Keep order dates in YYYY-MM-DD form. Response validation should check the original serialized payload and then send that payload unchanged. Source timestamps remain timezone-aware ISO instants.
