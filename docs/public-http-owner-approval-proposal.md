# Specific-permit approval — written requirement only

Nothing in this document was implemented or executed.

## Finding

The existing `pilot.ts approve --id ... --user-approved` command marks the
permit approved and assigns approval/expiry times (`artifacts/api-server/src/ujs/pilot.ts:227–264`).
It does not append an approval event to the job event log identifying the
specific permit's scope and current method.

## Minimum required command behavior

Keep the existing command and its explicit `--user-approved` confirmation.
When it approves a permit, have the command append an approval event to that
permit's job event log containing only:

- permit ID;
- office;
- event type;
- start and end dates (the permit's date window);
- and method ID.

The event records which one permit was explicitly approved. Do not add a
per-person authentication system, new auth identity, new approval UI,
permit-audit table, or a separate approval mechanism.

**Approval alone must not clear `ACCESS_DENIED`.** The existing successful
pilot-proof path may clear the stop only after its success predicates pass;
the approval command must not do so. A7's wording must preserve the distinction
between approval and post-success clearing.
