import { and, desc, eq, inArray } from "drizzle-orm";
import { db, discoveryRequestsTable, discoverySourceTable } from "@workspace/db";
import { discoveryPolicy } from "./discovery";
import { rollingUsage } from "./discovery-safety";

type Source = typeof discoverySourceTable.$inferSelect;
type Origin = { path: string; method: string; outcome: string; statusCode: number | null };
type Store = Pick<typeof db, "select">;
const barriers = ["SOURCE_VALIDATION_BARRIER", "ACCESS_UNVERIFIED", "COLLECTION_NOT_APPROVED"];

/** Only ordinary calendar jobs use this policy; never PDF or pilot authority. */
export function calendarOperationBlock(source: Source | undefined, origins: Origin[], now = new Date()) {
  if (!source) return "SOURCE_STATE_UNAVAILABLE";
  if (source.pausedUntil && source.pausedUntil > now) return "SOURCE_COOLDOWN";
  if (source.latencyWarning && source.blockedReason !== "RATE_LIMIT") return "LATENCY_WARNING";
  const reason = source.blockedReason;
  if (!reason || barriers.includes(reason)) return null;
  if (reason === "RATE_LIMIT" && source.pausedUntil && source.pausedUntil <= now) return null;
  if (reason === "HTTP_ERROR" && source.pausedUntil && source.pausedUntil <= now) return null;
  // A completed 200 Calendar Event HTML response rejected only by the former
  // shared size cap may be retried as a new, user-initiated, calendar-only job.
  // The exact source block and failed job/ledger stay untouched; document and
  // other collection paths continue to use collectionBlock and remain stopped.
  if (reason === "SIZE_LIMIT" && origins.length === 1
    && origins[0]!.outcome === "SIZE_LIMIT" && origins[0]!.statusCode === 200
    && origins[0]!.method === "POST" && origins[0]!.path === "/CaseSearch") return null;
  // An actual report-only 401/403 is evidence about document transport, not a
  // site-wide calendar ban. Unknown origins and any calendar denial fail closed.
  if (reason === "ACCESS_DENIED" && origins.length && origins.every(row =>
    row.outcome === "ACCESS_DENIED" && [401, 403].includes(row.statusCode ?? 0)
    && row.method === "GET" && ["/Report/MdjDocketSheet", "/Report/CpDocketSheet"].includes(row.path))) return null;
  return reason;
}

export async function calendarAdmission(store: Store, source: Source | undefined, now = new Date(), allowInFlightWait = false) {
  const origins = source?.blockedReason === "ACCESS_DENIED"
    ? await store.select().from(discoveryRequestsTable).where(and(
      eq(discoveryRequestsTable.sourceId, "UJS"),
      inArray(discoveryRequestsTable.outcome, ["ACCESS_DENIED", "CHALLENGE", "LOGIN_PROMPT"]),
    )).orderBy(desc(discoveryRequestsTable.startedAt))
    : source?.blockedReason === "SIZE_LIMIT"
    ? await store.select({
      path: discoveryRequestsTable.path,
      method: discoveryRequestsTable.method,
      statusCode: discoveryRequestsTable.statusCode,
      outcome: discoveryRequestsTable.outcome,
    }).from(discoveryRequestsTable).where(eq(discoveryRequestsTable.sourceId, "UJS"))
      .orderBy(desc(discoveryRequestsTable.startedAt)).limit(1)
    : [];
  const block = calendarOperationBlock(source, origins, now);
  if (block) return block;
  const usageRows = await store.select().from(discoveryRequestsTable).where(eq(discoveryRequestsTable.sourceId, "UJS"));
  if (!allowInFlightWait && (source?.activeRequestId || usageRows.some(row => row.outcome === "IN_FLIGHT")))
    return "REQUEST_IN_FLIGHT";
  return rollingUsage(usageRows.map(row => row.startedAt), now,
    discoveryPolicy.hourlyRequestCap, discoveryPolicy.dailyRequestCap).blockedReason;
}
