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
- Manual observations and user-initiated live jobs are supported; ordinary saved-record searches never contact court sources. One integrated live run verified the CP-05-02-Crim Formal Arraignment scope and one identity-checked docket sheet; other offices, events, and date ranges are not established. No countywide completeness or custody claims.
- The original Playwright document client received HTTP 403. An explicitly approved standard-HTTP assessment succeeded; the user then separately approved using that method in normal bounded live jobs. Assessed and integrated document paths use the same public HTTP transport, with no cookies, proxies, followed redirects, challenge solving or retries. New denials require operator assessment; success never proves permission, coverage, custody or freshness.
- Live jobs have a single application worker, PostgreSQL lease/checkpoints and a Python Playwright child, not a separate service. All transmitted source requests, including browser scripts/styles, share the persisted limiter; redirects and retries stop rather than proceeding automatically.
- A second operative observation for the same docket is rejected rather than silently replacing history. An explicit correction/supersession process is a later milestone.
- Numeric ranges exclude unknown amounts and nonmonetary conditions; they use one category and financial basis at a time. No recommended bail amount is produced.

## Product

Sign in, choose an ordinary Calendar Event search for Allegheny–05 with optional office/room/event filters and Scheduled Events Only, and explicitly start it. After the integrated method is verified, the job can retrieve identity-checked docket PDFs under the user's request and record caps. No per-run operator approval, single-use permit or fixed Courtroom 506/Bail Hearing scope applies to ordinary searches. Unfiltered searches default to one day; filtered windows are at most seven days. Eligible evidence is saved pending review, never automatically confirmed or operative. Source consultation time, local-file receipt and order dates remain distinct. See `docs/research-workflow.md` for current operation-scoped access and pacing policy; older pilot notes are historical.

Ordinary authenticated jobs can retrieve docket PDFs after the integrated source method is verified; the user's explicit Start Search action fixes the criteria and budgets for each job. Retrieval is paced and stops on denial, challenge, throttle, timeout, validation failure, or uncertain state. Local uploads remain a separate fallback and are never described as live retrieval. Unknown/nonmonetary/deposit-ambiguous amounts never satisfy the monetary TOTAL_BAIL maximum. Shown-posted exclusion tests SHOWN_POSTED only; NOT_SHOWN is not proof of nonpayment or custody. Legacy processing jobs retain their original criteria and history.

This is a private-per-account research prototype, not a complete production team workspace. Shared permissions, correction/suppression and retention operations, general imports/exports, and unproven live coverage are not implemented.

## Live collection controls

- Python dependencies are in `pyproject.toml`/`uv.lock`; Chromium is in the Nix system dependencies. The API build copies its Python adapter into `dist/ujs/`.
- Ordinary jobs use the user's explicit request cap (default 12, maximum 500) and record cap (maximum 200); all transmitted page, asset, search and PDF requests count. Matching targets count distinct dockets, not processed rows.
- Pacing enforces at least 60 seconds after each response plus bounded 0–30 second variation; higher adaptive backoff, shared hourly/daily quotas, and server-directed waits win. These are application safeguards, not published court rates. Only one source request is in flight and automatic retries remain disabled.
- Preserve checkpoints and historical failures. A proven report-only document denial is not a permanent calendar ban, but calendar denials/challenges, unknown origins, active cooldowns and uncertainty still stop admission. Do not bypass restrictions, invent source parameters or reopen consumed historical permits.
- See `docs/ujs-source-access-assessment.md` for proof, accounting, limitations, and operator recovery. Retired standalone probes must not be used to bypass the shared limiter.

## User preferences

- The absolute data rule is recorded in `.agents/memory/no-fabricated-records.md`.
- Future live-source work must count actual network requests, including background browser requests, prevent duplicate work, apply source-specific pacing/concurrency/retries, preserve partial results, and surface challenges, rate limits, and unresolved access requirements.
- Do not silently change source-access strategies or report failed retrievals as successful. Networking approaches are not categorically excluded; assess each source's access requirements.

## Gotchas

- Calendar HTML response policy and offline/live evidence boundaries: see `docs/calendar-response-handling.md` (`UJS_CALENDAR_HTML_MAX_BYTES`; PDF limits are separate).
- See `.agents/memory/date-only-response-validation.md` before changing date serialization or generated response validation.
- Use managed Clerk configuration and its proxy middleware; do not create `.env` files.
- Do not describe the application as current/countywide data or as custody verification.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
