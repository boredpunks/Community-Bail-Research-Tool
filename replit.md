# Community Bail Research

A research workspace for a small group of community volunteers to inspect verifiable docket-backed bail observations and descriptive financial ranges.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/community-bail-research run dev` — run the web artifact through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `PORT=5173 BASE_PATH=/ pnpm run build` — standalone typecheck + build all packages (managed workflows provide these values themselves)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract; regenerate client hooks and Zod validation after changing it.
- `lib/db/src/schema/` — immutable source observation fields and append-only review history.
- `artifacts/api-server/src/routes/bail-records.ts` — authenticated record/search/review/range endpoints.
- `artifacts/community-bail-research/src/` — Civic Mainframe interface with a Standard view option.

## Architecture decisions

- Research is private per account until explicit team membership and role controls are configured. This avoids exposing research to every new signup; shared-team collaboration is not yet implemented.
- Confirming source evidence is separate from deciding whether an order is operative. Neither retrieval order nor the largest or latest amount automatically establishes an operative order.
- Manual observations and explicit live-discovery jobs are supported; ordinary saved-record searches never contact court sources. Live coverage is limited to the demonstrated Allegheny Common Pleas criminal Bail Hearing calendar and identity-checked docket sheets.
- The original Playwright document client received HTTP 403. An explicitly approved standard-HTTP assessment succeeded; the user then separately approved using that method in normal bounded live jobs. Assessed and integrated document paths use the same public HTTP transport, with no cookies, proxies, followed redirects, challenge solving or retries. New denials require operator assessment; success never proves permission, coverage, custody or freshness.
- Live jobs have a single application worker, PostgreSQL lease/checkpoints and a Python Playwright child, not a separate service. All transmitted source requests, including browser scripts/styles, share the persisted limiter; redirects and retries stop rather than proceeding automatically.
- A second operative observation for the same docket is rejected rather than silently replacing history. An explicit correction/supersession process is a later milestone.
- Numeric ranges exclude unknown amounts and nonmonetary conditions; they use one category and financial basis at a time. No recommended bail amount is produced.

## Product

Sign in, search saved observations, explicitly start a bounded live-discovery job, save selected source observations as pending, review them, and inspect minimum/median/maximum ranges from confirmed reviewed-operative numeric observations. Source consultation time, source-owned timestamp, and order date remain distinct. Calendar date inputs are today/future only, at most seven days; unsupported MDJ, Preliminary Arraignment and historical coverage is not silently substituted. Local discovery amount filters are provisional, not operative ranges.

New discovery jobs fix a desired number of distinct matching dockets and collection filters at creation. Download one docket at a time, check matches, and continue past nonmatches until the target, returned-page exhaustion, or a safety cap stops the job. Unknown/nonmonetary amounts never satisfy the monetary comparison; any extracted monetary TOTAL_BAIL entry may qualify, without an operative-order claim. Shown-posted exclusion never excludes UNKNOWN as though it meant not posted. Independent report display filters cannot change the job's fixed filters or target. Legacy jobs retain their original processing-only criteria.

This is a private-per-account research prototype, not a complete production team workspace. Shared permissions, correction/suppression and retention operations, general imports/exports, and unproven live coverage are not implemented.

## Live collection controls

- Python dependencies are in `pyproject.toml`/`uv.lock`; Chromium is in the Nix system dependencies. The API build copies its Python adapter into `dist/ujs/`.
- Initial defaults: five processed documents and twelve requests per job, one concurrent source request, zero automatic retries. The limiter now waits at least thirty seconds after the previous response completes (also respecting its start). These controls are not permission or a verified safe rate.
- Operator-only server settings: `UJS_MAX_RECORDS` (1–200), `UJS_MAX_REQUESTS` (8–500), `UJS_SPACING_MS` (30000–3600000), `UJS_RATE_LIMIT_COOLDOWN_MS` (900000–86400000). Shared operator ceilings now permit up to 200 processed dockets/500 requests; new-job defaults remain 5/12 and require explicit user budgets. The UI cannot change operator policy. Raising policy never enlarges an existing job.
- Collection can run slowly at larger approved budgets. Pause/cancel retain checkpoints; restart pauses interrupted jobs for explicit resume. Rate limits pause source-wide; challenges/access denial/redirects require operator assessment, not another networking workaround.
- See `docs/ujs-source-access-assessment.md` for proof, accounting, limitations, and operator recovery. Retired standalone probes must not be used to bypass the shared limiter.

## User preferences

- The absolute data rule is recorded in `.agents/memory/no-fabricated-records.md`.
- Future live-source work must count actual network requests, including background browser requests, prevent duplicate work, apply source-specific pacing/concurrency/retries, preserve partial results, and surface challenges, rate limits, and unresolved access requirements.
- Do not silently change source-access strategies or report failed retrievals as successful. Networking approaches are not categorically excluded; assess each source's access requirements.

## Gotchas

- See `.agents/memory/date-only-response-validation.md` before changing date serialization or generated response validation.
- Use managed Clerk configuration and its proxy middleware; do not create `.env` files.
- Do not describe the application as current/countywide data or as custody verification.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
