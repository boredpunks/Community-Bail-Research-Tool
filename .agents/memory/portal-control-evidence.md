---
name: Portal title/model control evidence
description: Why calendar selects must not be associated through the portal's label for attributes.
---

The user supplied live-portal evidence on October 18, 2026: the Room, Court
Office, Calendar Event Type, Judicial District and Search By labels all had
null `label.control`. Their visible selects were unnamed and unidentified, but
had public titles; successful values came from named hidden text/model inputs
inside the Search button's owning form.

**Why:** The Room label referenced a nonexistent ID. Treating that missing
association as a different-form owner misdiagnosed the reported failure; the
user explicitly supplied the live association evidence and ruled out another
inspection request to rediscover it.

**How to apply:** Bind these widgets through their public titles and prove the
current native/model values in the Search form's actual FormData. Never revive
label-for assumptions for these widgets. Synthetic control fixtures verify
supported binding behavior, not live access; keep calendar and document-client
access proof separate.
