# Integrated calendar engine: setup and acceptance boundaries

## Reproducible local setup

Use the project's existing pnpm workspace, PostgreSQL development database,
managed workflows, Python 3.13 and installed Chromium. Do not use a virtual
environment or replace the existing authentication or database.

1. Configure authenticated Git with `gh auth setup-git --hostname github.com`,
   then `git fetch origin`. Work on `fix/calendar-result-integration`, not main.
2. `pnpm install --frozen-lockfile`
3. Ensure the existing Python dependencies (`playwright` and `pymupdf`) and the
   system Chromium executable are installed using the project's package setup.
   The safety runner verifies worker packaging before running. It uses the
   project dependencies normally; it does not stub imports.
4. `pnpm --filter @workspace/db run push` adds the nullable operator-delegation
   column in development. Review schema changes before applying them elsewhere.
5. `pnpm --filter @workspace/api-spec run codegen`
6. `pnpm run typecheck`
7. `pnpm --filter @workspace/api-server run test:safety`
8. `pnpm --filter @workspace/community-bail-research run test:discovery-retention`
9. `pnpm --filter @workspace/community-bail-research run test:calendar-preview`
10. `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/community-bail-research run build`
    (Use the artifact's assigned base path when different.)
11. Restart the existing API and web workflows. API startup builds its bundle.

`RESEARCH_WORKSPACE_PASSWORD` and `SESSION_SECRET` must be configured through
workspace Secrets. Never place their values in commands, documentation or Git.

## Source authority is separate from setup

The global `SOURCE_VALIDATION_BARRIER` must stay in place. Passing tests,
preparing a permit, logging in, or successfully launching a job is not source
proof or permission to retry.

The bounded method is `playwright-calendar+urllib-pdf-v14-bounded-506-v6`.
It uses the existing exact-client calendar and sequential public PDF clients.
Optional browser images are served a local transparent SVG without source
transmission. Required scripts/styles, unknown console errors, runtime
exceptions and unknown resource failures still block document eligibility.
Historical console errors have not been declared harmless.

An operator may prepare a fresh exact scope, using the pilot CLI:

```
pnpm --filter @workspace/api-server run pilot prepare-bounded-engine \
  --start YYYY-MM-DD --end YYYY-MM-DD \
  --supersedes FAILED_PERMIT_UUID --delegate-workspace
```

Omit `--supersedes` only for a scope with no prior permit. This never edits,
resets or authorizes a consumed permit. Fresh user approval for the exact
scope/method/budget is required after a failed run, before the operator's
separate approval command. Dates are never changed automatically.

## App-based launch and ownership

The shared-password login identifies one research workspace, not individual
volunteers. This is deliberately not a Clerk migration or a claim of personal
operator roles. Only a permit explicitly delegated by the operator to that
workspace appears in its approved-search panel. The app has no approval,
delegation, reset, budget-override or barrier-clear endpoint.

`POST /api/discovery/assessments/{id}/start` consumes one approved, unexpired,
exact-method permit belonging to the authenticated workspace. It accepts no
criteria override. A source-row lock and permit-row lock serialize duplicate,
concurrent and cross-scope launch. The worker executes only the stored scope,
retains original aggregate accounting, and writes the final scoped report
without granting global source proof. Pausing/cancelling does not restore
single-use authorization.

Persisted criteria responses permit historical observation budgets below eight
requests. The separate new-job input contract still requires eight or more.
Do not increase stored budgets or hide old jobs merely to make responses validate.

## Calendar acceptance and retained evidence

`CALENDAR_LAYOUT` is a separately validated, bounded structural projection:
row/cell/span counts, fixed status categories and link representation counts.
It contains no arbitrary source text, URLs, docket identifiers, names, query
values or tokens. Presentation-shaped rows and familiar status wording are
**not** accepted as validated empty results. Unsupported rows/links still stop.

The existing document path requires calendar criteria/result eligibility,
an allowlisted source-provided link, matching PDF court/docket identity, and
supported extraction. Evidence keeps document hash/page count, bail-section
pages and entry pages. Saving remains explicit and pending review, never an
automatic operative-order or custody finding. Page metadata does not change
the observation's duplicate identity.

## What qualifies as end-to-end acceptance

Use an authenticated browser and a fresh approved scope. Follow the actual app
launch through a source-provided docket link, PDF retrieval, identity check,
bail extraction, displayed page references and explicit pending save. Check
the request ledger, persistent result and unchanged barrier afterward.

Offline public-form/markup tests contain no case records or docket PDFs and
do not establish live document access. A clean build, parser regression pass,
clearer error report, or successful launch is **not** engine completion. If
the live source stops, retain the exact reason, end the attempt, and obtain
fresh approval before any further source attempt.
