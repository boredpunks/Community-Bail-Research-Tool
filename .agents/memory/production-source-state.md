---
name: Published app source state
description: Why a working preview does not show the published app can search, and where to look first when the live app refuses searches.
---

The published app has its own database, so its source stops, cooldowns, access proof and request ledger are independent of development. A working preview does not show that the published app can search.

**Why:** On 2026-11-01 the published app refused every search because of a stored TIMEOUT stop from an early-morning court timeout, while development searches ran normally. Production had also never completed its first PDF access check.

**How to apply:** When the user says the live app fails, read the production source-control row, recent request ledger and production logs (read-only) before changing code. A republish restarts the server but does not reset stored source state.
