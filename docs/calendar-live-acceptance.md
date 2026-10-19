# Calendar-only live acceptance — October 19, 2026

## Outcome: blocked, not accepted

One authenticated, deliberate Search-screen submission reached the integrated
calendar client. The application stopped on `SIZE_LIMIT` after the Search
response returned HTTP 200. Calendar rows, explicit-empty proof, source actions,
and result coverage were **not validated**. This does not establish zero matches,
successful calendar discovery, or a court denial.

No retry, alternate transport, substituted criteria, document request, local
upload, source-link opening, permit creation, or approval-gate restoration
was performed. No application code or source barrier was changed.

## External restriction review before submission

The following public pages were reviewed separately from the integrated job:

- https://ujsportal.pacourts.us/ — distinguishes public calendars from secure
  services requiring login and approved access. Only the public search was used.
- https://ujsportal.pacourts.us/Home/Terms — describes use-at-own-risk and
  liability disclaimers. The retrieved terms did not state an automation ban,
  request minimum, or per-search operator approval requirement.
- https://ujsportal.pacourts.us/robots.txt — returned the portal's missing-page
  message, not usable robots directives.

This limited review is not a finding of affirmative permission or an exhaustive
legal-policy assessment. Search-engine retrieval and the three policy-page
fetches are separate from the four integrated requests below; they do not prove
integrated client access. Existing quotas, pacing, denied-operation history,
cooldowns, authentication, and stop rules were not bypassed. The app reported
calendar available and automated documents off before the search.

## Exact submitted scope

- County: Allegheny–05.
- Method: Calendar Event.
- Start and end: `2026-10-19` (one day).
- Office, courtroom, event: `ANY` (no filters).
- Scheduled Events Only: checked.
- Server-owned `calendarPreviewOnly: true`, `requestCap: 8`, `recordCap: 1`.
  The record cap did not cause this stop and does not establish a one-row
  calendar result limit.

The UI submitted exactly one `POST /api/discovery/searches`, receiving HTTP
201. Job `e612664b-cb9d-46ef-8bb6-1cf2bede17ea` was created at
`2026-10-19T06:14:00.893Z`. UI values and persisted criteria agreed.
The integrated response diagnostic retained
`criteriaValidation: INTERCEPTED_POST_BODY_MATCHED`; required script and
stylesheet were loaded and the form reached `FORM_READY`.
This proves the submitted-body check, not the scope of unparsed result rows.

## Actual persisted source ledger

All timestamps below are UTC on October 19, 2026. Bundle cache-version query
values are deliberately omitted.

| Method | Institutional path | Start | Completion | HTTP | Outcome |
| --- | --- | --- | --- | --- | --- |
| GET | `/CaseSearch` | 06:14:04.996 | 06:14:06.125 | 200 | OK |
| GET | `/resource/css/sitemain.min.css` | 06:14:06.391 | 06:14:06.511 | 200 | OK |
| GET | `/resource/js/sitemain.min.js` | 06:14:06.781 | 06:14:06.920 | 200 | OK |
| POST | `/CaseSearch` | 06:14:08.948 | 06:14:11.905 | 200 | SIZE_LIMIT |

Four of eight slots were consumed, including both assets; one Search submission,
one classified failed response, zero report/PDF requests, zero documents
processed. Observed starts followed preceding completions by 266 ms, 270 ms,
and 2,028 ms respectively. These are application safeguards, not court-published
rates.

Final job status: `PAUSED`, updated at `2026-10-19T06:14:11.905Z`.
The UI reports `SIZE_LIMIT: all source traffic stopped`, retains consumed slots,
and offers no automatic retry or workaround. Calendar admission now reports
unavailable with `SIZE_LIMIT`. The previous `ACCESS_DENIED` remains historical
admission metadata; it is not this attempt's HTTP outcome.

## Validation and independent-document behavior

- `calendarComplete: false`.
- `paginationComplete: false`.
- `resultCapReached: false` (not evidence that all results fit).
- Zero validated rows, **no** validated explicit-empty result.
- Result parser: `NOT_RUN`; inspection: `NOT_SAFE`;
  response completion: not validated; transport: `SOURCE_STOPPED`.
- Console diagnostics: clean; the size stop is not evidence of a script error.
- Source document actions, row office/event/date scope: `NOT_CHECKED`.
  No claim about their presence, absence, completeness, or usability is made.
- No bail observations were created. No PDF was needed to submit the search,
  retain its ledger, or display its stopped/unknown result.

The same job, exact date scope, `PAUSED` status, and
“Unknown: no validated calendar response” were visible after page reload without
another Search. A separate authenticated, local-API-only read confirmed the
four ledger entries, single POST, no report paths, stopped status, and diagnostics.

The classifier currently labels bodies larger than 4,000,000 bytes `SIZE_LIMIT`
before inspecting their contents. No response byte count or content was retained
in this acceptance report. Therefore the exact size, page structure, possible
embedded restrictions, and presence of rows remain unknown; HTTP 200 alone
cannot settle them.

## Evidence and next step

Private screenshots and aggregate JSON are in the ignored directory
`generated-artifacts/calendar-live-acceptance/`. No source HTML, docket
identifiers, document query parameters, session cookies, or credentials are
included in this committed report.

Successful live acceptance remains outstanding. First investigate the response
size policy and safe diagnostics offline, with bounded synthetic regressions.
Do not raise a cap or clear a source stop merely to force this search through.
Any later live check must be separately user-initiated after the blocker is
resolved, not an automatic retry of this job. Document transport acceptance is
a separate work item and was not attempted here.
