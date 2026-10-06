# Community Bail Research

A research workspace for a small group of community volunteers to inspect verifiable docket-backed bail observations and descriptive financial ranges.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/community-bail-research run dev` — run the web artifact through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
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
- The first milestone accepts manual source-backed observations only. No live adapters or file imports are enabled, and saved-record searches do not contact court sources.
- A second operative observation for the same docket is rejected rather than silently replacing history. An explicit correction/supersession process is a later milestone.
- Numeric ranges exclude unknown amounts and nonmonetary conditions; they use one category and financial basis at a time. No recommended bail amount is produced.

## Product

Sign in, search saved observations, enter real source evidence, review pending observations, and inspect minimum/median/maximum ranges from confirmed reviewed-operative numeric observations. Source consultation time, source-owned timestamp, and order date remain distinct.

This is an initial private-per-account prototype, not a complete production team workspace. Shared permissions, correction/suppression and retention operations, verified imports, exports, and live source adapters are not implemented.

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
