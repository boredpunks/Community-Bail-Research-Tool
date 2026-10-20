# Development enum change and rollback boundaries

The schema source already declares RECORDED_BAIL_AMOUNT. This additive SQL
artifact records the narrowly authorized development operation without an
application-startup, build, deployment or production migration hook:

`lib/db/migrations/20261021_recorded_bail_amount.sql`

```sql
ALTER TYPE public.bail_financial_basis
  ADD VALUE IF NOT EXISTS 'RECORDED_BAIL_AMOUNT';
```

## Separation printed before application

Read-only queries used `current_database()` and the MD5 of a typed server
address or Unix socket directory. Development uses a local Unix socket, so
inet_server_addr() is null; hashing a generic “unknown” value would not prove
a host identity. That first null-address result was not used as separation
proof. The final comparison was:

| Environment | Database | Host fingerprint | Basis |
|---|---|---|---|
| development | heliumdb | da3482a1dba6ed20b916a1e69efd2e0b | md5('unix:' + server unix_socket_directories setting) |
| production | neondb | 1d7771392bacb28ae42bc6bd642985c3 | md5('tcp:' + inet_server_addr()) |

Distinct database names and server transports/fingerprints establish distinct
targets. No connection string, password, token, username or raw host was
printed. Production operations were read-only.

Before:

- Development: TOTAL_BAIL, CASH_DEPOSIT, SURETY_BOND, UNSECURED_AMOUNT,
  RECORDED_BAIL_AMOUNT.
- Production: TOTAL_BAIL, CASH_DEPOSIT, SURETY_BOND, UNSECURED_AMOUNT.

The exact SQL file content was passed to
`executeSql({environment: "development", sqlQuery: <file content>})`.
Output: `ALTER TYPE`, exitCode 0, success true. A development-only readback
returned all five labels. Since the value already existed, this demonstrates
an idempotent application/check, **not** adding a previously absent value.
No scratch schema was needed for this change. Production was not migrated.

For a future manually reviewed reproduction, only after rechecking separation:

```sh
# Workspace DATABASE_URL must still be the development target.
# Do not substitute a production connection string.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/20261021_recorded_bail_amount.sql
cd artifacts/api-server
node tests/run-completion.mjs
```

The normal dev schema source of truth remains
`lib/db/src/schema/bail-records.ts`. No broad schema push was used to perform
this single authorized operation. No deployment or automatic production DDL
was added; any later production schema application remains the separately
reviewed platform Publish flow.

## Destination, producer and acceptance inventory

- Actual destination: `public.bail_records.financial_basis`, PostgreSQL enum
  `public.bail_financial_basis`. Discovery JSON provenance also carries the
  basis, but JSON acceptance is not enum storage proof.
- Producer: `artifacts/api-server/src/ujs/bail_table.py` conditional recorded
  Amount column. CP and geometry-backed MDJ extraction consume this table
  parser (`evidence.py`, `mdj_bail.py`); neither infers the release amount from
  the percentage or posted-security amount.
- Contract source: `lib/api-spec/openapi.yaml` FinancialBasis.
- Generated acceptors: `lib/api-zod/src/generated/api.ts`, its generated
  `types/financialBasis.ts`, and
  `lib/api-client-react/src/generated/api.schemas.ts`.
- Database TypeScript schema: `lib/db/src/schema/bail-records.ts`
  financialBasisEnum/insertBailRecordSchema; discovery provenance/entry types
  in `lib/db/src/schema/discovery.ts`.
- Parent extraction validation: `lib/discovery-worker.ts` uses the generated
  provenance schema; destination values come through
  `lib/discovery-candidates.ts:observationValues`.
- Manual-create/range acceptance: `routes/bail-records.ts` validates
  financial basis/category and queries the matching basis independently.
- Filtering/projection/export: `lib/bail-research/src/index.ts` recognizes
  RECORDED_BAIL_AMOUNT as a recorded monetary setting; it does not convert it
  to TOTAL_BAIL. Legacy strict TOTAL_BAIL filtering remains distinct.
- UI label: `artifacts/community-bail-research/src/lib/money.ts`.

## Genuine destination-type regression

`artifacts/api-server/tests/completion.ts` extracts the supplied genuine CP
fixture, inserts an observation into the actual destination table inside a
transaction, and performs a **separate SELECT**. Assertions check $100
(10000 cents), RECORDED_BAIL_AMOUNT, separate 10.00% condition, source page 1,
exact extracted row and overall evidence excerpt. The review write remains
inside the same transaction. An intentional exception rolls everything back;
a SELECT outside the transaction asserts the saved UUID does not exist.

This is offline storage/readback proof, not a live source observation or
evidence of production enum acceptance.

## Rollback

Fixture rows are rolled back transactionally; do not delete genuine records.
PostgreSQL has no `DROP VALUE` for one enum label. Do not replace/rebuild the
enum, cast tables, or remove the value as a Phase 2 rollback. The additive
development label remains. Reverting code does not remove it. Any later
destructive schema rollback needs separate review. Production is unchanged.
