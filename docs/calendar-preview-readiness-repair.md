# Calendar preview readiness repair — offline outcome

## Defect and remaining evidence gap

The retained October 16 v4 attempt used three successful bootstrap GETs and no
Search POST. Its exact code was `CALENDAR_FORM_STRUCTURE_CHANGED`. The worker
used `document.querySelector("#btnSearch")?.form` to collect successful
`FormData` field names before criteria selection, then required the entire
ordered sequence to be identical after selection and date entry.

That code also used the same error when the snapshot was absent, empty, over
128 entries, or contained an overlong unredacted field name. The retained
attempt cannot distinguish those branches or identify a changed field.
It does not prove that the court changed its form.

The error handler wrote `formVisible=false` for every pre-POST failure; it did
not measure visibility there. No form-container visibility condition existed.
The historical false flag therefore does not establish that the Search button,
form or filter controls were hidden.

Controlled public-form fixtures demonstrate two local defects: a valid
dependent-widget replacement changes the whole-form field sequence and is
rejected by that equality check; a button associated after document load needs
an explicit initialization wait. Neither fixture establishes the live cause.

## Integrated repair

- Wait at most 15 seconds for one visible, enabled, form-associated Search
  button. A form container need not have its own rendered box.
- Bound successful form entries at 128 and field-name length at 128 without
  retaining names or values. Do not require the entire pre/post field sequence
  to be identical.
- Before Search, re-resolve and validate the current intended controls, unique
  identity, form ownership, exact source-label selection/readback, backing
  values, native submitted values, permitted action, POST method, form encoding
  and source date constraints. No substitute office, event, room or date.
- For the latest criteria without a courtroom field, require one enabled,
  same-form `CourtRoomID` select with its unique empty, unlabelled no-filter
  option already selected. Recheck its exact empty submitted value before
  Search. Do not silently retain Courtroom 506 or reset a selected room; absence
  of this proof stops before POST with a fixed courtroom diagnostic.
- Retain only fixed phase/control/reason diagnostics. Initialization timeout,
  hidden/missing/ambiguous button, wrong-form association, disabled controls,
  unavailable options/date bounds and backing/submitted-value mismatch have
  distinct bounded categories. Existing resource/script/error counts remain.
- Observe Search-button visibility on failure; an unreadable page is unknown,
  not a fabricated false observation. Parent diagnostic rejection has its own
  fixed local event, without retaining the rejected payload.
- Keep the existing calendar-preview route and worker. Preview rows remain
  read-only calendar results, never PDF/bail evidence or saved candidates.
  The app now explicitly separates running, validated results, partial
  coverage, unvalidated failure, source-validated zero and expired results.
  Zero requires the server's validated-empty event and complete coverage;
  no source empty marker has been invented or enabled.

Form/submission behavior changed, so fresh proof/approval must use
`playwright-calendar-preview-v5`. The shared integrated worker is
`playwright-calendar+urllib-pdf-v10`; prior v4/v9 proof does not authorize these
versions. Historical reports remain historical. No inspector enablement,
broker/seccomp change, accounting redesign, new permit type or barrier-clear
operation was added.

## Verification and limitations

Final command outcomes are recorded below after the combined checks complete.
The controlled worker fixtures contain only public controls and a header-only
table, never docket/case records. Parser-reaching fixtures must still finish
as `RESULTS_NOT_VALIDATED`, not a successful or empty source search.

The saved-record search, manual source-backed observation and review handlers
were checked locally: they require workspace authentication but do not consult
the court-source collection barrier. No new observation or case fixture was
created to exercise them. Their data-mutation paths were not changed.

## Single proposed live scope — not approval

No permit may be created, approved, reset or consumed until separate explicit
approval is received. The proposal is one current-method calendar preview:

| Item | Exact proposed scope |
| --- | --- |
| Method | `playwright-calendar-preview-v5`, final repair revision reported with delivery |
| Dates | October 17–19, 2026 inclusive, America/New_York; same dates as the latest v4 attempt |
| Selection | Calendar Event; Allegheny - 05; `CP-05-02-Crim`; `Bail Hearing` |
| Courtroom | **No courtroom filter**, explicitly replacing the earlier Courtroom 506 criterion rather than claiming it was applied. The latest nonlegacy v4 criteria had no courtroom field. The source must prove its empty no-filter selection before POST; the worker will not silently retain or reset a source-selected room. Approval must explicitly cover this no-filter scope; otherwise do not run. |
| Documents | Zero PDFs; zero docket-document retrieval; no link opening |
| Budget | Eight total transmitted request slots, including required assets, failed requests and uncertain transmissions; at most one Search POST |
| Inventory | Three bootstrap GETs + one Search POST; identical result assets use memory cache; changed-version result CSS/JS can require two more GETs. All additional allowed asset transmissions must fit the same eight slots, not a raised ceiling. |
| Spacing | Concurrency one; 60–90-second completion-to-next-start jitter; the persisted scheduler enforces at least its configured minimum and any longer quota/cooldown wait. No request while a prior transmission is in flight or uncertain. |
| Time limits | Bootstrap navigation 600 seconds; visible Search-button readiness 15 seconds; Search click/commit/completion 180 seconds including pacing; each source fetch 45 seconds; result grid 45 seconds after Search POST completion. A response lasting 20 seconds or more stops the preview before another request. |
| Permit | Existing single-use operator route; approval expires after 24 hours and stale dates/method/scope fail closed. There is no additional whole-session wall-clock deadline; the existing phase, request, freshness and permit-expiry bounds apply. |
| Retry/stop policy | Zero automatic retries; no method switch, date expansion or remote pagination. Stop on denial, rate limit, challenge, login, redirect, non-OK/unsupported response, slow response, resource/script/unclassified-console failure, initialization/control/submission mismatch, unavailable exact criteria, unsupported or conflicting result layout/date, parent rejection, exhausted budget or unresolved transmission. |
| Display/retention | Only validated source-order calendar rows: docket identifier, selected office/courtroom scope, event type/date, filing date when present, retrieval provenance and coverage limits. No names or arbitrary case cells. Unsaved results expire under the existing 24-hour retention rule; request/attempt history and fixed diagnostics are preserved. |
| Barrier | `SOURCE_VALIDATION_BARRIER` remains in place. The existing exceptional operator permit admits only its saved exact calendar scope, without general access proof, collection approval or PDFs. |

A completed calendar preview would be the first usable search milestone, not
proof of PDF access, bail extraction, eligibility, release, custody or readiness
for broader collection. Any original-evidence uncertainty that recurs must be
reported using the new bounded diagnostics, not followed by speculative retries.
