# Community Bail Research completion checklist

Status values: Not started / In progress / Passed / Blocked / Not applicable.
The current uploaded master prompt supersedes the earlier search-reset direction.

| Work item | Status | Dependencies | Verification |
|---|---|---|---|
| Current-checkout inspection | In progress | None | Compare current source, recent merged changes, and required documents |
| Dependency and runtime verification | Not started | Inspection | Install/lockfile consistency, startup logs, adapter/browser availability |
| Calendar-control repair | Not started | Inspection | Observed controls and matching structural regression |
| Common Pleas search criteria | Not started | Calendar controls | Observed labels/bindings and criteria tests |
| MDJ search criteria | Not started | Calendar controls | Observed labels/bindings and criteria tests |
| Result and document-link handling | Not started | Criteria | Source-backed rows/actions, traversal and coverage tests |
| Common Pleas PDF parsing | Not started | Genuine fixtures | Primary identity, recorded amounts, page references |
| MDJ PDF parsing | Not started | Genuine fixtures | Primary versus originating identity, layout/event extraction |
| Percentage-bearing amount handling | Not started | PDF parsing | Recorded amount stays separate from percentage |
| Setting/posting separation | Not started | PDF parsing | Posting never substitutes for the setting amount |
| Historical-action handling | Not started | PDF parsing | Settings distinct from revocation/denial context |
| Event preservation and deduplication | Not started | Calendar/PDF handling | Multiple events retained; unique docket fetched once |
| Shared monetary matching | Not started | Evidence representation | Inclusive bounds, posted default, distinct docket counts |
| Job/API integration | Not started | Criteria, matching, worker | Authenticated launch/progress/control/recovery and terminal states |
| Schema and generated-contract updates | Not started | Integration design | Additive migration and regenerated clients/validators |
| Three-column results | Not started | API integration | Exactly Hearing date, Docket number, Bail amount |
| Evidence with page references | Not started | Parsing, API | Expandable page/excerpt/action/date/percentage evidence |
| Working source links | Not started | Document handling | Verified source-opening path |
| CSV export | Not started | Shared projection | CSV/table equivalence, date and amount format |
| Outcome and progress states | Not started | Job/API | Explicit exclusions, ambiguity, failure, partial, expiry |
| Legacy compatibility | Not started | Schema/API | Retained reports/checkpoints/review and comparison behavior |
| Genuine fixture tests | Not started | Uploaded PDFs | Separate criteria and expected recorded values |
| Regression suite | Not started | Implementation | Typecheck, focused tests, safety suite, diff checks |
| Live Common Pleas verification | Not started | Offline correctness | Current small search through associated PDF/evidence/CSV/reload |
| Live MDJ verification | Not started | Offline correctness | Separate current small search through associated PDF/evidence/CSV/reload |
| Production build | Not started | Regression checks | Actual build and packaged Python/browser/runtime |
| Deployment | Not started | Production build | User publishes prepared release through existing setup |
| Deployed signed-in journey | Not started | Deployment | Production search/evidence/export/reload |
| Final documentation and delivery report | Not started | Verification | Per-scope status, commands, migrations, limitations, blockers |

## Findings and blockers

- The reset previously disconnected search launch, resume, and worker startup. Current work must reconnect the existing engine rather than create a parallel one.
- Publishing is a user-controlled workspace action; prepare and verify the release, then request that action.
