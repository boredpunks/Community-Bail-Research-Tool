---
name: ROR classification
description: How release on own recognizance is represented in bail evidence.
---

Treat ROR (release on own recognizance) as a nonmonetary release, not a $0 bail amount. Keep its category as recognizance and its amount and financial basis null, even when the source prints `$0.00`.

**Why:** The user clarified that ROR means release on own recognizance without bail.

**How to apply:** Normalize ROR to recognizance in PDF extraction and display it as a release type. Reject conflicting nonzero amounts instead of silently discarding them.
