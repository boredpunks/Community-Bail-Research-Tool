# Filing court-control diagnostic

## Status and purpose

The single-use read-only inspection completed under separate explicit user
approval. The earlier “proceed” instruction authorized offline preparation
only; execution was authorized by the later filing-inspection approval form.
Both this permit and the earlier coverage permit are consumed. Neither
authorizes another request.

## Continuing bounded read-only diagnostics

When approving the revised inventory, the user added **“as many as it takes.”**
This authorizes continued needed read-only diagnostic inspections within the
same request/action limits, using a fresh single-use permit each time. It does
not itself authorize Search, PDF, date/court/county/case/office activation, source-stop
overrides, higher budgets, alternate clients or wider collection. No identical
inspection is repeated without a new evidence need.

### Approved public office identification — October 12, 2026

The user selected **“Allow public office identification”**, with no additional
comments. This extends retained diagnostic metadata to bounded recognized public
institutional labels and displayed district-05 office codes, with no private
option values, arbitrary labels, names or identities. It does not authorize
office selection, other filters, Search, dates, PDFs or dependent transmissions.

Current method: `playwright-filing-control-inventory-v7`, preserving the five
v6 phases and action sequence. After local Allegheny selection, a closed
`officeIdentification` object reports candidate count, snapshot control ordinal,
state, recognized displayed codes and unrecognized option count. A visible,
enabled, publicly associated search-form-owned native select with court/office
words is only an observation candidate, not a verified control role or binding.
Missing/ambiguous/oversized candidates retain no codes; oversized options are
never read. At most 250 recognized codes emit; exceeding this stops with
`FILING_OFFICE_CODE_LIMIT`, without retaining a partial code list.

Displayed `MJ`/`MDJ` or Magisterial District Court prefixes classify codes as
`EXPLICIT_MDJ`; plain numeric `05-n-nn` codes stay `DISTRICT_CODE_UNVERIFIED`.
Only the code token and classification/enabled/selected flags emit; trailing
names are excluded, docket-like suffixes rejected, and option values never used
for identification. Duplicate displayed codes are preserved as observations,
not deduplicated into assumed unique choices. Unknown options stay unknown.
Codes are recognized as standalone displayed tokens, including compact prefixed
MJ/MDJ notation canonicalized to `05-n-nn`. Multiple code tokens in one label stay
unknown. Native `option.label` is used, because that is the browser's displayed
label and can differ from underlying text. No private option values are read for
identification.
The parent independently validates candidate/state accounting, code grammar,
closed keys, counts and phase readiness. Historical v6 reports remain readable
but cannot execute v7. Trailing colon/asterisk label markers are normalized as a
sequence; added exact institutional labels remain a closed vocabulary.

#### Completed identification checks — unresolved

| Permit (consumed) | Job | State | Run UTC | GETs | Minimum completion-to-start pause | Maximum request duration |
| --- | --- | --- | --- | --- | --- | --- |
| `d45acd9d-847b-44ef-848f-443aabaf87bc` | `ed856f4c-3015-4444-9942-69fcbbad64d7` | INSPECTED | 22:08:08–22:10:29 | 3 | 64.309 s | 950 ms |
| `a1a41b03-377c-4a48-b2e7-ccb56c960822` | `4bb93170-86dc-4e18-8406-66eb8609158a` | INSPECTED | 22:12:42–22:15:21 | 3 | 77.230 s | 810 ms |
| `06bc06f9-3429-468a-9763-ea6155378a6d` | `da37b8b0-294f-4cce-9b50-a4648a9cc851` | INSPECTED | 22:16:53–22:19:01 | 3 | 60.886 s | 664 ms |

All nine bootstrap GETs completed HTTP 200/OK, with no failures or documents.
Each attempt parent-validated all five phases. Office identification stayed
`NOT_READY` until County selection, then observed one active native search-form
candidate with a public group association and 49 options. Only generic court/
office words were recognized; the exact institutional label stayed unrecognized.
All 49 displayed options remained unrecognized and no codes were retained in
`COUNTY` or `FINAL`.

The first check used the initial prefix formats. The second broadened code-token
position recognition and compact MJ/MDJ formatting, preserving the same closed
metadata/action contract and code cap. The final check corrected the label
reader to use browser-displayed `option.label` rather than underlying text.
Each recognizer change passed its focused redaction fixture before source use.
No further identical or speculative-format inspection is justified by these
results. A redacted public label/option example is needed to resolve recognition
without reading private values, guessing an office or assuming a court type.

An empty retained code list is **not** an empty source dropdown, an absence proof,
unsupported MDJ coverage, or access proof. `INSPECTED` is protocol completion
only; the requested public office identification remains unresolved. No names,
arbitrary labels or private values were retained, and no office, case category,
date or Search action was taken. No dependent requests, remote POSTs, PDFs or
records were transmitted/collected.

Offline verification passed API typecheck/build, 242 safety checks and all 44
network-blocked Python tests. The later token-format and displayed-label reader
changes each passed the focused public-office redaction test and build checks.
Fixtures are hypothetical public form controls, not docket/case records.
The managed API was restored after each attempt and started cleanly; the public
app rendered without browser errors. All permits are consumed. Source state has
`SOURCE_VALIDATION_BARRIER` and no pause, active request, latency warning, access
proof or collection approval. All three discovery/PDF/extraction routes and the
overall task remain **blocked, not complete**.

### Approved local Allegheny selection — October 12, 2026

The user selected **“Allow local Allegheny selection”**, with no additional
comments. Continued needed inspections may now select filing mode, check the
unique exact Advanced Search checkbox, and locally select the exact Allegheny
option in the unique eligible source-labeled County native select. This does not
authorize another county, court/case/office selection, dates, Search, PDFs,
dependent transmissions, budget changes or collection.

At this stage the method was `playwright-filing-control-inventory-v6`, with ordered phases
`INITIAL`, `FILING`, `ADVANCED`, `COUNTY`, `FINAL`. A closed `county` object reports
candidate count, eligibility and selected state. The parent independently
validates these against the redacted controls and requires eligible/selected in
the final two phases. Eligibility requires established filing mode and checked
Advanced Search, one exact County native select, search-form ownership, public
association, visibility/enabled state, in-bounds options and one enabled exact
Allegheny choice. The action uses ephemeral source option/select handles; no
retained ordinal, guessed identity or private value is used as an adapter binding.
Already-selected Allegheny is not changed again. Missing/ambiguous/inactive
controls or options fail closed with `FILING_COUNTY_NOT_ESTABLISHED`. Any dependent
request is locally aborted and stops all later actions; it is never transmitted
or retried. All original three-GET caps, pacing and mandatory stops are unchanged.
Historical reports remain readable, including v5, but only a fresh current-method
permit can execute this scope.

#### Completed local County selection and focused label check

| Permit (consumed) | Job | State | Run UTC | GETs | Minimum completion-to-start pause | Maximum request duration |
| --- | --- | --- | --- | --- | --- | --- |
| `e8d12048-c0f4-4cf7-903a-2e8e4cb2e4b4` | `d90750d0-5ef2-4ef0-97d6-26e9d8975b4e` | INSPECTED | 21:33:19–21:35:40 | 3 | 66.264 s | 881 ms |
| `6f2ed2b8-dd54-47a5-933f-0469a7beffdf` | `1bf781f4-bc01-452c-86d4-773e5d8bd0f8` | INSPECTED | 21:38:06–21:40:57 | 3 | 72.227 s | 806 ms |

All six GETs completed HTTP 200/OK, with zero failures or documents. All five
ordered phases passed parent validation, with 36 retained controls. County became
eligible after Advanced Search and its exact Allegheny choice became selected in
`COUNTY` and stayed selected in `FINAL`. The previously disabled court-related
native select became visible/enabled and went from zero to 49 observed options,
without any dependent transmission. No court option was selected.

The first run did not recognize its exact public label. A focused vocabulary-only
revision added generic Court Number/No/#/Code/ID/Identifier/Division/Jurisdiction,
Court Offices/Office(s)/(s), required/optional Court labels, Trial/Local/County/
Municipal Court labels, and matching fixed public words. Typecheck/build and the
targeted no-other-action/redaction fixture passed. This did not change the v6
metadata or action contract or retain arbitrary labels, identities or values.

The second run recognized only the generic words **court** and **office** on this
active 49-option select; its exact label remains unknown. No exact public MDJ
choice was established. This is not proof that MDJ options are absent, nor does
it prove that the 49 options are MDJ courts or offices. Docket Type stayed hidden/
disabled with one exact Criminal choice among eight options. Judicial District,
Case Category, Case Status and the separately recognized Court Office widget
also stayed inactive. The oversized active unknown-type list stayed uninspected.

Offline preparation passed 226 safety checks, typecheck/build and the 42 Python
tests across the initial pass and focused corrected-fixture recheck. The duplicate
County fixture required proper label-for association instead of a wrapping label
whose text included option text. Fixtures are hypothetical public controls only.
The subsequent vocabulary revision passed typecheck/build and its focused fixture.

Both permits are consumed. The API was restored and started cleanly. The source
still has `SOURCE_VALIDATION_BARRIER`, no active request, pause, latency warning,
access proof or collection approval. No dates, other county, court/case/office
selection, Search, remote POST, PDFs or records were entered, transmitted or
collected. The engine and all three discovery/PDF/extraction routes remain
**blocked, not complete**.

Next evidence needed: identify public court-office choices and their MDJ context.
Extending retained metadata to public office labels/codes required the explicit
metadata-scope approval now recorded above and a new method. No office selection, private value/
identity retention, source-stop override or extra transmission is authorized.

### Approved Advanced Search activation — October 12, 2026

The user selected **“Allow Advanced Search activation.”** Continued bounded
inspections may now select filing mode, check the unique exact source-labeled
Advanced Search native checkbox owned by the search form, then observe resulting
public controls. This does not authorize any other selections, Search, dates,
remote POST, PDFs, wider collection or budget/stop changes.

At this stage the method was `playwright-filing-control-inventory-v5`. Ordered phases are
`INITIAL`, `FILING`, `ADVANCED`, `FINAL`. A closed `advancedSearch` object records
candidate count, eligibility and checked state; the parent independently checks
candidate/eligibility consistency and requires an eligible checked checkbox in
the final two phases. The action resolves an ephemeral ElementHandle from a
fresh bounded exact-label inventory, not a stored ordinal or guessed identity.
It never forces hidden, disabled, ambiguous or other-form widgets. An already
checked checkbox is not toggled. Missing eligibility or failed activation stops
with `FILING_ADVANCED_NOT_ESTABLISHED`. Any dependent request is aborted locally
and stops further phase actions; no such transmission is granted.

The unchanged partial-option policy, closed vocabulary, redaction, widget,
form-element and reference limits still apply. Historical v1/v2/v3/v4 reports
remain readable, but the worker only accepts a fresh current-method permit.
210 offline safety checks and all 21 network-blocked worker tests passed;
activation fixtures are hypothetical public controls, never court records or
source coverage proof. The source observations below now establish local
activation and its limited effect, not MDJ coverage or submitted bindings.

#### Completed source activation and label check

| Permit (consumed) | Job | State | Run UTC | GETs | Minimum completion-to-start pause | Maximum request duration |
| --- | --- | --- | --- | --- | --- | --- |
| `952b2a0a-96db-49b8-ae91-e7e87c01bc5a` | `d3618dea-80d9-494d-8572-216c6fdfe415` | INSPECTED | 21:06:54–21:09:06 | 3 | 60.954 s | 912 ms |
| `f359714c-5d1f-4d25-9e3f-203e7a93e172` | `b29d3eac-7322-474c-b38d-750bd57fea64` | INSPECTED | 21:13:11–21:15:23 | 3 | 62.213 s | 903 ms |

Each completed exactly the three bootstrap GETs, all HTTP 200/OK. No Search,
dates, court/county/case/office selections, transmitted POST, PDFs or records.
All four phases were parent-validated with 36 retained controls. Advanced Search
changed from hidden/disabled/unchecked, to eligible/unchecked after filing mode,
to eligible/checked after the authorized local check. Its native-successful flag
then became true; that flag is not submitted model-binding proof.

The first run established that activation made the exact public **County**
control visible/enabled with 68 in-bounds options, one exact **Allegheny** choice,
and no Allegheny selection. An otherwise unclassified court-labeled dropdown
became visible but remained disabled and had zero current options. Judicial
District, the Criminal-choice dropdown, Case Category and Court Office stayed
hidden/disabled. One oversized unknown-type dropdown and an unclassified
“only”-word checkbox also became active; neither was selected or inspected
beyond the existing permitted metadata.

A focused public-label recognition revision then added CP Court, CP County,
MDJ Court, MDJ County, MDC Court, MDC County, Magisterial District Court(s),
Court of Common Pleas, Common Pleas Court, Originating Court/County, Court Name,
Court Location, Docket Type, Docket Category, Case Status and Active Only.
The fixed public-word vocabulary added cp, mdj, mdc, originating, location,
docket, status and active. No arbitrary text, private name/identifier, link URL
or new action was retained or performed. Typecheck and the targeted bounded
label/redaction fixture passed. This is a vocabulary revision of the same v5
metadata/action contract, not a court-selection adapter.

The second source run established the Criminal-choice widget's exact public
label as **Docket Type** (8 options, hidden/disabled) and another hidden/disabled
widget as **Case Status**. County remained active with the exact Allegheny
choice unselected. The disabled court dropdown's exact label remains
unrecognized; no CP/MDJ context or MDJ choice was established. Do not infer its
purpose or whether County activation will populate it merely from generic words.

The next meaningful action to test would be local selection of the unique
source-labeled County control's exact Allegheny choice, then observation only.
That required the separate approval now recorded above. It must not imply an MDJ court selection, substitute
Common Pleas, click Search, enter dates or select another filter. Within the
unchanged diagnostic cap, any dependent request must still be aborted locally
and stop the attempt rather than transmitted or retried.

Both permits are consumed; no unused permit or active source request remains.
The API was restored. Source state still has `SOURCE_VALIDATION_BARRIER`, no
pause, active request, access proof, collection approval or latency warning.
All three discovery/PDF/extraction routes and the overall engine remain
**blocked, not complete**.

### Completed partial inventory (v3) — October 12, 2026

Permit `2b50054e-31d3-4c46-81ed-4438f81d9a5d` is `INSPECTED`, consumed.
Job: `aca10038-e05e-47d3-9cbf-393c7b6a3910`.
Approval: 19:31:28 UTC; run: 19:31:37–19:34:13 UTC.
Three successful bootstrap GETs; no failed requests, Search, POST, dates, PDF or
records. All `INITIAL`, `FILING` and `FINAL` inventories passed parent validation.

Each phase retained 29 controls. Filing was selected in the latter two phases.
The known County, Judicial District, Case Category and Court Office widgets
remained hidden/disabled. A source-listed Criminal choice occurred in a hidden,
disabled dropdown with an unrecognized label. One oversized hidden/disabled
dropdown remained explicitly unknown. No retained public MDJ choice was observed
in the in-bounds options. This does not establish unsupported MDJ coverage.

One otherwise unclassified checkbox became visible/enabled after filing-mode
selection. Its label and purpose were not established by the closed vocabulary;
it was not toggled. Navigation links were outside the v3 candidate set. These
are further observation gaps, not a confirmed activation sequence or permission
to interact. Native widget flags still establish no submitted model bindings.
The API was restored; collection and access verification remain disabled.

### Completed link/label inventory (v4)

Method: `playwright-filing-control-inventory-v4`. This read-only revision adds
native/ARIA links (observation only) and exact generic public filter labels
including Court Types, Case Types, Search All Courts, All Courts, Search All
Cases, All Cases and Include Closed Cases. It also observes exact public
Common Pleas choice labels solely as context; it never selects Common Pleas
or substitutes the user's court/method.

To expose recognition gaps without retaining arbitrary labels, the inventory
retains only the presence of these fixed generic words: all, court, courts, case,
cases, criminal, search, system, type, types, county, closed, include, exclude,
magisterial, district, common, pleas, level, by. Word presence is not an exact
public label, action instruction, control role or submitted binding proof.
No link URL, identifier, private word or arbitrary text is retained. No link,
tab, popup, checkbox or court filter is clicked; filing mode is the sole local
selection. All request/resource caps, pacing, protected stops, unknown-option
states and redaction limits remain unchanged.

API typecheck, 196 safety checks and three targeted network-blocked worker tests
passed. Historical v1/v2/v3 metadata remains readable; current execution requires
the current method and a fresh permit. Search/PDF/extraction routes remain
unverified, and the overall engine is **blocked, not complete**.

Two v4 observations then completed under the user's continued bounded
read-only diagnostic approval:

| Permit (consumed) | Job | State | Run UTC | GETs | Minimum completion-to-start pause |
| --- | --- | --- | --- | --- | --- |
| `f19825b1-35d1-4f3f-a82e-7fe99116069c` | `b6b9fbe4-b414-41c1-8503-c29be5a4a5aa` | INSPECTED | 19:39:07–19:41:30 | 3 | 60.382 s |
| `3d327b4b-4903-4a2b-b028-e7d6464a691e` | `be58ff25-777f-4d5b-af22-db66a61f784c` | INSPECTED | 19:43:55–19:46:31 | 3 | 62.522 s |

Both used only the same three bootstrap paths, all GET/HTTP 200/OK; maximum
request durations were 1071 ms and 1268 ms, respectively. No Search, POST, date,
PDF, case record or control activation except filing mode. Each retained 36
controls in all three ordered, parent-validated phases.

The first observation still did not identify an MDJ control. It retained one
newly visible checkbox with only the recognized generic word “search.” A
focused recognition-vocabulary revision added the exact generic labels Advanced
Search, Enable Advanced Search, Use Advanced Search, Show Advanced Search, Limit
Search, Restrict Search and Enable Filters, plus the fixed words advanced,
enable, enabled, show, options, filters, filter, limit, limited, restrict,
restricted, specific, within, only, use and criteria. No raw label was retained
or guessed action performed. Typecheck and the focused no-activation/redaction
fixture passed after that vocabulary change.

The final observation established **one public `Advanced Search` native checkbox**,
associated by the public DOM control group and owned by the search form:

- `INITIAL`: hidden and disabled.
- `FILING` and `FINAL`: visible and enabled, after the source-listed filing mode
  was selected.
- The checkbox was **never toggled**. Its raw identity/value and checked state
  were not retained; `nativeSuccessful=false` does not prove it was unchecked.
- The known court filters remained hidden/disabled, and no MDJ choice was
  established. Do not claim Advanced Search enables those filters until that
  local action and resulting source state are separately observed.

At that point, the next meaningful diagnostic was to select filing mode and locally check only
this unique, source-labeled `Advanced Search` checkbox, then inventory the
resulting controls. This exceeds the existing **filing-mode-only** action scope
and required explicit action-scope approval, now recorded above. It still has three bootstrap
GETs only, no Search/dates/court/county/case/office selection or PDFs, and must
abort any dependent request locally. Do not repeat the completed inventories
without a new evidence need.

Across these latest v3/v4 attempts, nine GETs completed successfully; the v3
minimum pause was 66.735 seconds with maximum latency 1006 ms. The API was
restored after each attempt. Source state still has `SOURCE_VALIDATION_BARRIER`,
no active request, latency warning, access proof or collection approval.
All three discovery/PDF/extraction routes remain unverified; the overall
engine is **blocked, not complete**.

## Latest approved guard inspection — October 12, 2026

The user separately approved one inspection to identify the failing guard.
Permit `0ac5c77c-866a-444a-b0ce-ae5f1b1e938d` is `FAILED`, consumed.
Job: `99f44bae-27bf-4eb3-a2c1-1f6821b531c3`.
Approval: 19:19:50 UTC; run: 19:19:59–19:22:45 UTC.

| GET | HTTP status | Duration | Since prior response completion |
| --- | --- | --- | --- |
| `/CaseSearch` | 200 | 1089 ms | — |
| `/resource/css/sitemain.min.css` | 200 | 365 ms | 79.765 seconds |
| `/resource/js/sitemain.min.js` | 200 | 331 ms | 79.679 seconds |

The diagnostic identified **`FILING_OPTION_LIMIT`** before retaining any
inventory phase. At least one nonsensitive-identity dropdown exceeded the
2,000-option observation limit. Its label, form ownership, exact count and
purpose were not retained; do not assume it is the court selector or assign this
guard retrospectively to the earlier generic failure.

All three requests completed `OK`; no Search, date entry, court/county/case/office
selection, POST, PDF, case record or retry. The API was restored and started
cleanly. The existing `SOURCE_VALIDATION_BARRIER` remains; no active request,
latency warning, access proof or collection approval. The inspection did not
establish the actual court control, MDJ scope or submitted bindings.

## Historical offline oversized-option correction (v3)

Method: `playwright-filing-control-inventory-v3`. This revision was
prepared and tested **offline only** after the consumed guard inspection.
It has not been approved for live execution or run against the portal.

The option limit remains **2,000**, not increased or bypassed. An oversized
native select or custom combobox has:

- `optionState: OVER_LIMIT`;
- `optionCount`, `publicChoices` and `selectedPublicChoices` all `null`;
- only the same bounded, allowlisted public label, association, visibility,
  enabled, ownership and native-success metadata observed.

No option labels, selected labels or values are inspected for an oversized set.
In-bounds controls retain `optionState: OBSERVED` and their validated counts.
Other controls can therefore be observed without pretending that the skipped
list was empty or lacked MDJ options. Unknown choices establish no role, scope,
absence, binding or source support. No selectors, filter actions or office
codes are inferred from incomplete inventory.

Widget/form/ARIA/group guards still stop the whole diagnostic. The initial
filing-mode recognizer still requires its existing unique eligible source
option and 64-option bound. No court/county/case/office control, popup or tab is
activated; Search, dates, PDFs, extra requests, retries and collection remain
prohibited. All original shared request caps, pauses, quotas, health stops and
single-use approvals remain unchanged.

The parent validates explicit observed/unknown states and rejects unknown states
disguised as zero counts. Current-worker metadata and prepared permits require
v3. Historical v1/v2 reports remain readable, but their permits cannot execute
this revision.

Verification: API typecheck, all 191 offline safety checks and six targeted
network-blocked worker tests passed. Fixtures cover oversized native/custom
lists remaining unknown while other controls are inventoried, redaction,
remaining guard failures, outside-form widgets and blocked dependencies.
There was no second live attempt, source-state reset, new permit or Search/PDF
assessment after this correction.

A later v3 source observation needs **fresh explicit approval** of the partial,
inventory-only scope (at most three bootstrap GETs, zero POSTs/PDFs, filing mode
only). Its protocol completion would not establish search or collection proof.
The overall engine remains **blocked, not complete**.

## Previous approved inventory failure — October 12, 2026

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

## Historical offline inventory revision (v2) — October 12, 2026

The original preparation approval covered **offline preparation only**.
That `FILING_INSPECT` method was `playwright-filing-control-inventory-v2`.
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
