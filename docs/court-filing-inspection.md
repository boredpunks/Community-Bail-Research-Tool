# Filing court-control diagnostic

## Status and purpose

Offline preparation only; no court request authorized by the user's “proceed”
instruction. That instruction accepted the offer to prepare the diagnostic
offline, not to execute it. The earlier coverage permit is consumed and cannot
authorize this different method.

The three-method engine remains **blocked, not complete**. The earlier approved
inventory established a locally selectable filing mode and public filing date
bounds, but did not establish MDJ criminal court controls or submitted field
bindings. The earlier post-Search failure also remains unresolved.

Prepared October 12, 2026:

- Permit `454fbf03-5ed8-44a2-a1a9-241a7acfaafd`, `PREPARED`, not approved or run.
- Stored legacy dates October 14–20, 2026; never entered or submitted.
- Three-GET cap, zero PDF/POST caps, no job or source requests.
- Operator report confirmed no approval/start/completion timestamps or evidence.
- API workflow restarted successfully after the offline code batch.

## Proposed single-use scope

Operator stage: `FILING_INSPECT`.
Method: `playwright-filing-form-inspection-v1`.

- At most three GETs total: `/CaseSearch`, `/resource/css/sitemain.min.css`,
  `/resource/js/sitemain.min.js`, with existing bounded version-query rules.
- Zero Search clicks, date entry, remote POSTs, PDFs, results or saved records.
- Select filing mode only by a unique source-listed public filing label.
- Observe the public controls, then locally select Court Type = MDJ,
  County = Allegheny and Case Type = Criminal, in that order, **only** when the
  source control and matching public option are unambiguous and eligible.
- No office is selected. No Common Pleas, alternate county, event discovery or
  other case category is substituted.
- Recognized public label variants are diagnostic vocabulary, not source
  evidence. Multiple matching controls or options fail closed. An absent,
  disabled or unrecognized control is reported as missing evidence, never as
  proof that the method or court is unsupported.
- Missing roles are not guessed from private field names. Only direct public
  label/ARIA associations or an explicitly source-listed public DOM control
  group are inspected. The previously verified SearchBy widget is reused to
  select filing mode; no filing option value is invented.
- Office codes are retained only for a source-confirmed local MDJ +
  Allegheny + Criminal filter state. Only public MJ/MDJ district-05 codes pass
  the closed redaction policy; at most 250. Missing codes are not proof that
  no offices exist.
- All further nonoptional requests after bootstrap abort locally and fail the
  inspection, including dependent-control fetches. Optional assets remain
  blocked under the existing policy. No retries, extra assets or cap increases.
- Existing one-in-flight ownership, rolling quotas, 60–90-second
  response-completion pauses, adaptive waits, source health/cooldown stops and
  single-use expiry/accounting remain intact. Roughly three minutes, possibly
  longer if shared pacing or quotas require it.

Recognition vocabulary for Court Type includes public options labeled
Magisterial District Court, Magisterial District Courts, Magisterial District,
or MDJ. A uniquely matching value remains transient. This does not establish
which label the portal actually offers or authorize a different court type.

## Retained metadata and limits

Five fixed phases: FILING, COURT_TYPE, COUNTY, CASE_TYPE, FINAL.
Each contains a closed control-role matrix for Search Mode, Court Type,
County, Case Type and Court Office:

- Candidate, option and successful native-field counts.
- Visible/enabled flags, recognized choice presence and exact selected-choice
  match flags.
- Candidate relationship category: direct public label, DOM group or none.
- Public filing date minimum/maximum constraints and native-success flags.
- A local filter-state flag and eligible source-listed MDJ office codes.
- Count of unclassified select widgets, never their labels or values.

No raw page, input name, option value, personal label/value, hidden token,
cookie, submitted body or console text is retained. Public DOM identities and
FormData stay transient; the persisted parent validates every field, bound,
phase and scope consistency before storing observations.

A DOM relationship or matching pre-submit FormData count is **not submitted
binding proof**. This diagnostic never fires Search or transmits a form.
Unknown labeling, hidden widgets, text-based date widgets or source dependency
order may leave evidence incomplete; the inspector does not invent selectors
or revisit missing filters automatically. A dependent fetch stops the attempt.

`INSPECTED` means the bounded observation completed, not that MDJ coverage,
server search, date acceptance or PDF access was verified. It cannot set access
verification, clear an earlier source barrier or enable collection.

Legacy CP/Bail Hearing criteria, record-cap-one and stored start/end dates are
storage placeholders only. Actual PDF and POST caps are zero. Stored dates are
never entered or submitted; they are not a filing-date search authorization.

## Offline checks and operator flow

Passed: 160 offline safety checks, 27 network-blocked Python protocol/browser
tests, API typecheck/build and whitespace checks. Tests use hypothetical public
filter markup only—never case rows or fabricated docket identifiers. The actual
worker is exercised for successful public-label selection/redaction, missing
labels, ambiguous options and aborted dependent requests. The scheduler is
tested against a disposable empty PostgreSQL schema, including POST/PDF denial
and preservation of the collection stop.

```
pnpm --filter @workspace/api-server run pilot prepare --stage FILING_INSPECT --start YYYY-MM-DD --end YYYY-MM-DD --requests 3
```

Preparation makes no source request and is not approval. Obtain new explicit
approval for this exact scope before recording operator approval or starting
the runner. Stop the managed API worker for its existing exclusive runner lease,
execute that one permit, restore the API workflow and report retained evidence.
Do not reuse a consumed/stale permit or treat diagnostic success as approval for
Search/PDF verification or collection.
