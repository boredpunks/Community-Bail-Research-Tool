---
name: Calendar-only operator approval
description: Approval boundaries for narrow source checks while regular collection remains blocked.
---

A user-approved one-use calendar gate is separate from general source access and collection approval. Approval to build it is not approval to run it.

**Why:** The user approved a separate one-use operator gate only for the selected calendar search, with regular collection blocked and PDFs disabled.

**How to apply:** Obtain fresh execution approval for the exact scope. Preserve the source-wide barrier, stop without retries on failed validation or denial, and do not treat calendar results as PDF access proof or bail evidence.

Keep the exceptional gate operator-only rather than exposing it to every shared-password web session.

**Why:** The shared workspace login does not distinguish an operator from other workspace users. The existing operator CLI preserves that boundary without creating a broader web permission.

**How to apply:** Use the operator flow for exceptional checks unless the user separately requests and approves a role model. Ordinary web collection stays blocked.
