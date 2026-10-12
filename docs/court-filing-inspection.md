# Filing court-control diagnostic

## Status and purpose

The single-use read-only inspection completed under separate explicit user
approval. The earlier “proceed” instruction authorized offline preparation
only; execution was authorized by the later filing-inspection approval form.
Both this permit and the earlier coverage permit are consumed. Neither
authorizes another request.

## Latest approved live result — October 12, 2026

The separately approved **one** v2 inventory attempt has now run and stopped.
Permit `9a2d8ad0-26fc-45c2-918d-337f4cdcbd84` is `FAILED`, consumed.
Job: `e404354f-525b-4ccf-ab57-635ddafca70c`.
Approval: 19:09:17 UTC; run: 19:09:25–19:12:41 UTC.

| GET | HTTP status | Duration | Since prior response completion |
| --- | --- | --- | --- |
| `/CaseSearch` | 200 | 3273 ms | — |
| `/resource/css/sitemain.min.css` | 200 | 585 ms | 76.896 seconds |
| `/resource/js/sitemain.min.js` | 200 | 221 ms | 81.843 seconds |

All three requests completed `OK`; zero failed network requests, POSTs, PDFs or
case records. No retry or expanded scope. The diagnostic stopped before retaining
its first inventory phase with `FILING_CONTROL_INVALID`. Consequently the actual
court widget and MDJ scope remain unestablished. This is an inventory-validation
failure, **not** evidence of source denial, unsupported filing coverage or an
empty search. The retained generic code does not identify which guard failed.

The exception path's `SUBMISSION_NOT_OBSERVED` / `formVisible=false` event does
not mean Search was attempted or the form was observed hidden: the filing path
never clicks Search, and that exception-path boolean is not a DOM observation.
No raw source page, private value, console text or unvalidated inventory was
retained for retrospective diagnosis.

Post-run source state has `SOURCE_VALIDATION_BARRIER`; no active request, latency
warning, access verification or collection approval. The barrier has not been
cleared. The managed API was restored and started cleanly.

### Offline correction after the failed attempt

The inventory's existing limit checks now report fixed public guard categories:
widget limit, native-form element limit, option limit, ARIA-reference limit or
group-reference limit. No bound was increased; labels, values and identifiers
are still redacted. This improves future failure reporting only—it does not
identify the historical failing guard or establish source support.

Four targeted network-blocked tests passed (including subcases for each guard,
success/redaction and dependent-request abortion). No second court attempt,
new permit, source-state reset or Search/PDF assessment was made.

Another source observation requires a fresh separately approved single-use
scope. All three discovery/PDF/extraction routes and the earlier post-Search
failure remain unresolved. The overall engine is **blocked, not complete**.

## Current offline revision — October 12, 2026

The original preparation approval covered **offline preparation only**.
The current `FILING_INSPECT` method is `playwright-filing-control-inventory-v2`.
At preparation time no permit/job was created or court request made. The later
separately approved, failed live result is recorded above; it supplies no access
proof or permission to retry. Collection remains disabled.

The revision replaces the v1 select-only, search-form-owned recognizer with
a bounded observational inventory:

- Observe `INITIAL`, `FILING`, then `FINAL`; select the previously established
  public filing mode only when its source-listed option is unique.
- Never select court type, county, case category or office. Never click a tab,
  radio, button, custom dropdown, Search or other navigation control. Never
  enter dates or transmit a search.
- Inspect native selects, radios and checkboxes, plus ARIA comboboxes, radios,
  tabs and radio menu items. Observe relevant public buttons without clicking.
  Native and ARIA controls outside the search form are included.
- Read directly associated labels, ARIA references, fieldset/group labels and
  source DOM control-group labels. Do not infer ownership from proximity.
  Custom dropdown options are observed only if already present inside the
  widget or its explicitly ARIA-controlled container; no popup is opened.
- Retain only exact allowlisted public labels: Search By; Court; Courts;
  Court Type; Court Level; Court System; Court Selection; Court Category;
  Court of Record; Judicial District; County; Case Type; Case Category;
  Court Office. Matching ignores capitalization, whitespace and trailing
  label punctuation. Unknown label text is never retained.
- Retain counts of recognized filing, MDJ, Allegheny and Criminal public
  choices and selected choices. Duplicate matches remain counts, not an
  instruction to pick one. Recognized choices identify **candidates**, not
  verified control purpose, MDJ scope or source coverage.
- Retain widget type, direct/ARIA/group/text association categories, presence
  of a public label, visible/enabled flags, native owner category
  (`SEARCH`, `OTHER`, `NONE`) and a native successful-field boolean.
  This last flag describes local pre-submit FormData only, not server bindings.
- Retain only per-snapshot ordinal numbers, not DOM IDs, selectors, field
  names, option values, raw labels, input values, hidden fields, HTML, cookies,
  tokens, console text, office codes, result rows or date values/constraints.
  Ordinals are not durable selectors; page changes may reorder controls.
- Fail closed above 128 candidate widgets, 512 search-form elements,
  2,000 options per widget or eight ARIA references per association.
  Sensitive-identity controls are omitted and counted. The parent validates
  the exact metadata shape, closed vocabulary, counts and phase order.
- The later source-observation scope remains at most the same **three bootstrap
  GETs**, zero POSTs and zero PDFs. All subsequent nonoptional requests,
  including dependencies triggered by filing selection, abort locally and
  stop the diagnostic. No retries or asset/cap expansion. Existing shared
  pacing, rolling quotas, source health stops and single-use permits remain.

The current worker accepts only v2 inventory metadata. Historical v1 reports
remain readable, but old or consumed permits cannot execute the revised method.
`INSPECTED` would still mean protocol completion, not successful court-context
recognition or discovery/PDF proof. Missing and inactive controls remain missing
evidence, not proof of unsupported coverage.

### Offline verification

- API typecheck passed.
- All 179 safety checks passed, including closed redaction/metadata validation,
  rejection of v1 metadata by the current inventory validator, unchanged
  three-GET scheduler restrictions and preservation of collection/source stops.
  Database tests used a disposable empty schema, not application case data.
- 30 of 31 network-blocked Python tests passed in the initial combined run;
  the sole failure was an unchanged calendar-click fixture's one-second
  timeout. That exact test passed when rerun alone. No calendar production
  code or timeouts were changed.
- All new/updated inventory fixtures passed: outside-form controls, native radio,
  ARIA tab/input-combobox, unknown-label redaction, hidden/disabled controls,
  filing-triggered local activation, duplicate MDJ observations without selection,
  ambiguous filing-mode stop, overflow stop and aborted dependent requests.
  Fixtures contain hypothetical public form controls only, never case records.
- Managed API build/restart passed with the new inventory module packaged and
  the old executable excluded. Startup logs were clean; the public app screenshot
  rendered normally with no browser errors. Whitespace checks passed.

### Later operator scope (not authorized)

Only after fresh explicit approval of this **inventory-only** scope may an
operator prepare/approve/run a new current-method single-use permit. Do not use
the consumed v1 permit. Existing CLI dates and CP/calendar criteria are storage
placeholders, never filing dates or substituted search permission. No approval,
source verification or collection enablement follows from this offline revision.

The engine remains **blocked, not complete**. The actual court-context control,
source activation sequence, submitted filing bindings, earlier post-Search failure
and separately approved integrated discovery/PDF/extraction proofs remain unresolved.

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

## Approved live result — October 12, 2026

Permit `454fbf03-5ed8-44a2-a1a9-241a7acfaafd` is now `INSPECTED`, consumed.
Job: `d6ab9cd1-c98b-486f-bc80-7d85f14031f9`.
Approval: 18:34:51 UTC; run: 18:34:53–18:37:43 UTC.

| GET | HTTP status | Duration | Since prior response completion |
| --- | --- | --- | --- |
| `/CaseSearch` | 200 | 1063 ms | — |
| `/resource/css/sitemain.min.css` | 200 | 338 ms | 67.223 seconds |
| `/resource/js/sitemain.min.js` | 200 | 312 ms | 77.921 seconds |

No failures, Search clicks, date entry, office selection, POSTs, PDFs or docket
records. All five metadata phases were retained and validated. The managed API
workflow was restored and started cleanly.

### What was established

- The filing mode was selected. Its public widget had one matching candidate
  native FormData field, not submitted binding proof.
- Both public filing date controls were visible/enabled, with bounds
  1899-01-01 through 2026-10-12 and one successful native FormData entry each.
- The recognized County, Case Type and Court Office widgets were hidden and
  disabled. The County widget contained 68 options, but the diagnostic did
  not establish any eligible county choice or select Allegheny.

### Semantic goal not established

The recognizer identified no Court Type control and counted 23 unclassified
form select widgets. The evidence does not reveal their labels, the actual
court-context widget, its control type/ownership, or the activation sequence.
Do not infer any particular cause from those counts.

Consequently no MDJ or Criminal choice was selected, no scoped MDJ office code
was established, and the local scope-ready flag stayed false in every phase.
`INSPECTED` means protocol/accounting completion, **not successful MDJ coverage**.
This is a diagnostic recognition gap, not proof that filing search or MDJ
coverage is unsupported, and not a network denial or an empty case search.

Post-run source checks found no active request, access-verification proof or
collection approval. The explicit blocked-reason field was empty; missing proof
still prevents collection and does not resolve the earlier post-Search failure.

Next evidence needed: the actual public court-context control and active filing
filter associations, without assuming a Court Type select label, the source
form ownership boundary or a particular backing-field layout. Revise the
diagnostic offline before proposing new bounded source observation. Do not retry
this consumed inspection, start a Search/PDF pilot, widen a date/court scope,
or interpret unavailable widgets as confirmed absence of source support.

## Historical consumed single-use scope (v1)

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

## Historical v1 offline checks and operator flow

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
