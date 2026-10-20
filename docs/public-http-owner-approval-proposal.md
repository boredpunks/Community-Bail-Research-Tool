# Specific-run owner approval — written requirement only

Nothing in this document was implemented or executed.

## Finding

The required in-app, owner-identified approval of the specific SINGLE pilot
does not exist. The legacy CLI requires `--user-approved`
(`artifacts/api-server/src/ujs/pilot.ts:200,227–264`), stores approvedAt and
expiresAt, and later creates a job using the fixed WORKSPACE_OWNER_ID
(`:314–325`). It does not record the authenticated approver or append an audit
event naming that approver and the method for this approval.
Existing bounded/ordinary-search routes are not approval of this SINGLE run.
The current password-authenticated workspace uses one shared owner identity
(`src/middlewares/researchAuth.ts:5`), not an individual approver identity.
A shared-session owner ID or a typed name cannot establish who approved.

`pilot.ts:422–429` automatically clears blockedReason and pausedUntil and
sets current-method proof only after its proof predicate passes. The
collectionApprovedAt field remains null. That automatic clear is currently
not linked to an owner-identified, in-app approval audit.

## Smallest separately reviewed addition

1. Establish a trusted individual owner/approver identity for this narrowly
   scoped approval (the existing shared password is insufficient), then reuse
   the owner-scoped job/permit UI. Do not imply this identity already exists,
   silently introduce an authentication migration, or trust a typed approver
   name. The identity/authorization design requires separate review.
   Show the immutable permit UUID, method id, court/office/event/room,
   current/future date window, recordCap 1, request budget, retained denial,
   no-retry behavior and strict 20-second verification threshold.
2. Add one authenticated **approve this specific run** action. Verify the
   operator is the owner, the permit is unused PREPARED, the method and exact
   criteria are current, the date is still today or later in Eastern time,
   and protected limits/cooldown/uncertainty rules still hold.
3. In one transaction record the approver identity, timestamp, permit UUID,
   expected method and immutable criteria identity in the existing audit
   stream, bound to the specific permit even before a job UUID exists.
   Existing job events alone need a job; either introduce the smallest
   permit-audit relation or create/link a non-running job at preparation under
   a separately reviewed design. Do not invent an unlinked “owner approved”
   event or accept a client-supplied identity.
4. Bind consumption/run to that exact owner-approved permit and audit record.
   Expiry, method/criteria changes and single-use state invalidate admission;
   repeat clicks are idempotent, not another run.
5. **Approval leaves ACCESS_DENIED set.** Only after all pilot predicates pass
   may the existing automatic clear run, additionally checking the matching
   owner-approval audit. Append a clear/proof event linked to the same
   approval, permit, job, approver and method. Failure preserves denial and
   proof/collection-approval nulls. Do not delete or edit historical denials.

A7's literal “cleared by approve” wording must be clarified before live work:
approval authorizes this run; the post-success transaction clears the block.
Approval by itself must not clear it. This is the owner's amended automatic
clear rule, not the original unconditional ban on worker-side clearing.

Required future offline checks: missing/wrong-owner/wrong-method/stale-scope/
expired approval rejected, concurrent duplicate approval/consumption excluded,
approval alone never clears denial, failed pilot never clears, and successful
pilot clears only with its matching audited approval. They are not substitutes
for the owner's separate A6 portal comparison or approval of any later batch.
