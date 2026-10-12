# Deferred pipeline options

The user requested that the unused suggestions from the pipeline attachment be
kept ready for a later safeguard revision. They are design options, not enabled
features or authorization to remove protections.

## Useful ideas applied offline

- Fresh locator resolution and final public-control/form-data readback.
- Date blur/change events before validation.
- Explicit submission gate and observed completed POST before results.
- Validation of missing links and every event date before deduplication.
- Specific parser reason codes and persisted page/console error counts.
- Fixed public-control labels and failure reasons, rather than logging actual
  field values or leaving form-readback failures as generic mismatches.
- Evidence-based separation of known optional-resource abort noise from
  unclassified console errors; required-resource and runtime failures still stop.
- Existing global request reservations, completion-based pacing, identity checks,
  first-seen docket order, saved comparator semantics and database-derived counts.

## Options for a separately authorized revision

1. **Outcome-based completion:** support proven partial-page/AJAX transitions,
   stable result generations, and exact validation/empty-state signatures.
   Keep full-navigation failure closed until the site's behavior is demonstrated.
2. **Replay laboratory:** sanitized, source-backed fixtures; mutation testing;
   redacted action/request metadata. Raw DOM can contain tokens and personal
   fields. Screenshot, HTML and PDF retention need an explicit privacy,
   access-control, storage and deletion policy first. Historical missing artifacts
   cannot be reconstructed without another approved acquisition.
3. **Coordinate-based PDF adapters:** source-backed layout invariants, token
   geometry and field-level provenance. Keep unsupported layouts explicit, rather
   than guessing the best fuzzy match or synthesizing a minimum bail value.
4. **Proven pagination:** page fingerprints, cycle detection, docket/event
   deduplication and demonstrated terminal controls. Additional pages count
   against separately approved dates, request budgets and time limits.
5. **Redirect policy:** consider only explicitly permitted destinations with
   every hop independently reserved and counted. Do not copy automatic
   `redirect: follow` from the pseudocode.
6. **Failure handling:** distinguish nonmatches from failures. Nonmatches can
   advance under an existing permit; access, uncertainty and identity failures
   must not be ignored. Any future candidate-specific continuation policy needs
   precise failure classes and explicit approval, not a blanket `continue`.
7. **Richer crash-state model:** consider separate reservation/transmission
   phases and compare-and-swap candidate transitions if future scale requires
   them. Never replay uncertain requests automatically.

The attachment contains conflicting bail-selection examples (one aggregate total
versus matching specific qualifying observations). Preserve the existing
observation-based behavior unless the user explicitly changes it. It also refers
to a 200-docket test; that is not authorization for any sample. Existing staged
authorization and the separate 100-distinct-match proposal remain the task scope.
