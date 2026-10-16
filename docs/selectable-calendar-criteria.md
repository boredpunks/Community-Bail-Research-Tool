# Selectable calendar criteria (offline work)

**Status: offline verification passed after the user-authorized correction.**
Full-project typechecking and build, 497 offline TypeScript safety checks and
66 Python tests pass. CLI rejection checks, workflow startup and API health
also pass. See the actual results at the start of
`completion-offline-checks.md`. No live search or PDF access was tested or
authorized by these results.

## Boundaries

This change implements selectable **Calendar Event** criteria, not filing-date
search or live-source verification. It does not authorize a request. The global
source barrier, disabled inspector, frozen inspection broker/sandbox, pacing,
request caps, zero-PDF calendar-preview boundary and all approval gates remain
in place. No permit was created or approved as part of this work.

## Dated public option evidence

The October 12, 2026 read-only observation in
[court-coverage-inspection.md](court-coverage-inspection.md) records:

- Calendar office labels: `CP-05-02-Crim`, `CP-05-02-Fam`, `CP-05-02-Juv`.
- Under the criminal office: `Bail Hearing` and singular
  `Preliminary Arraignment`.
- Calendar date constraints then observed: 2026-10-12 to 2999-12-31.

These are form options, not submitted-result or PDF proof. No MDJ office list
is inferred from the reported office count or fabricated from district codes.
The event choices are not claimed to exist at every office. A runtime missing,
disabled, ambiguous or changed office/event choice stops as
`CRITERIA_NOT_AVAILABLE_ON_SOURCE`; dates outside the runtime source constraints
stop with the same code. No alternate choice, method or date is used.
Unrecognized result layouts remain fail-closed under the existing validator.

## Inputs and approvals

The UI's shared office, event and date controls apply to both the calendar-only
preview and bail-discovery form. The server validates real dates, today or later
in America/New_York, with a maximum **seven-day inclusive** window. Local bail
filters and request/document budgets remain separate.

The OpenAPI schema and regenerated clients use `courtOffice`, `eventType`,
`startDate` and `endDate`; the old expired `eventDate` input is no longer offered.
Raw date strings are checked before using generated date-coercing validators.
Historical fixed-scope preview reports remain readable; they do not become
fresh permits.

Result event dates are normalized to ISO in the parser and validated against
the full inclusive requested window by the parent worker, not just its first
day. An offline date-only parser-to-worker regression covers later days without
creating synthetic dockets or case records.

Operator command syntax (documentation only; not run to prepare a permit):

```text
pnpm --filter @workspace/api-server run pilot prepare-calendar-only \
  --office CP-05-02-Crim --event "Preliminary Arraignment" \
  --start <chosen-today-or-future-YYYY-MM-DD> --end <chosen-YYYY-MM-DD>
```

All four criteria flags are required; nothing defaults to a different scope.
Preparation still requires the unchanged source barrier and no active request
or job, prevents duplicate exact-scope attempts, and is not approval to run.
Approval and run recheck saved exact criteria; the scheduler still checks the
permit/job equality, freshness, one Search POST, eight-request cap and no PDFs.
No new permit type or barrier-clear command was introduced.

## Coverage status

| Path | Status |
| --- | --- |
| Common Pleas criminal / Bail Hearing | Prior live evidence is historical; current selectable-criteria path not live-tried here |
| Preliminary Arraignment | Selectable, not live-tried here |
| Family / Juvenile office choices | Observed public options only; criminal-result/PDF coverage not established |
| Filing-date / MDJ | Not implemented by this change; no working-search claim |

Offline verification output is recorded in
[completion-offline-checks.md](completion-offline-checks.md).
