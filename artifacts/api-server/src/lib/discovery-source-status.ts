import { and, desc, eq, gt, or } from "drizzle-orm";
import { db, discoveryRequestsTable, discoverySourceTable } from "@workspace/db";
import { discoveryPolicy } from "./discovery";
import { collectionBlock, paceEligibleAt, rollingUsage } from "./discovery-safety";
import { sourceTransportCooldownUntil } from "./transport-cooldown";
import { effectiveAdaptiveSpacing } from "./research-pacing";

export async function discoverySourceStatus(now = new Date()) {
  const [source] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
  const requests = await db.select().from(discoveryRequestsTable).where(and(
    eq(discoveryRequestsTable.sourceId, "UJS"),
    or(gt(discoveryRequestsTable.startedAt, new Date(now.getTime() - 86_400_000)), eq(discoveryRequestsTable.outcome, "IN_FLIGHT")),
  )).orderBy(desc(discoveryRequestsTable.startedAt));
  const transportUntil = await sourceTransportCooldownUntil(db, source, now);
  const usage = rollingUsage(requests.map((request) => request.startedAt), now, discoveryPolicy.hourlyRequestCap, discoveryPolicy.dailyRequestCap);
  const inFlight = requests.some((request) => request.outcome === "IN_FLIGHT") || !!source?.activeRequestId;
  const reason = collectionBlock(source, now, transportUntil) ?? (inFlight ? "REQUEST_IN_FLIGHT" : usage.blockedReason);
  const currentSpacingMs = source
    ? effectiveAdaptiveSpacing(source, discoveryPolicy.spacingMs)
    : discoveryPolicy.spacingMs;
  const paceAt = source
    ? paceEligibleAt({ ...source, adaptiveSpacingMs: currentSpacingMs }, currentSpacingMs)
    : null;
  const next = Math.max(source?.pausedUntil?.getTime() ?? 0, transportUntil?.getTime() ?? 0,
    paceAt?.getTime() ?? 0, usage.nextEligibleAt?.getTime() ?? 0);
  const pilotState = collectionBlock(source, now, transportUntil) === "ACCESS_UNVERIFIED" ? "NOT_VERIFIED"
    : source?.accessVerifiedAt ? "VERIFIED_METHOD" : "BLOCKED";
  return {
    blockedReason: reason, collectionEnabled: !reason,
    pausedUntil: source?.pausedUntil?.toISOString() ?? null,
    accessVerifiedAt: source?.accessVerifiedAt?.toISOString() ?? null,
    verifiedMethod: source?.verifiedMethod ?? null,
    collectionApprovedAt: source?.collectionApprovedAt?.toISOString() ?? null,
    hourlyRequestCap: discoveryPolicy.hourlyRequestCap, dailyRequestCap: discoveryPolicy.dailyRequestCap,
    hourlyRequestsUsed: usage.hourlyUsed, dailyRequestsUsed: usage.dailyUsed,
    currentSpacingMs,
    nextEligibleAt: next > now.getTime() && !inFlight ? new Date(next).toISOString() : null,
    requestInFlight: inFlight, lastLatencyMs: source?.lastLatencyMs ?? null,
    latencyWarning: source?.latencyWarning ?? null, throttleCount: source?.throttleCount ?? 0,
    pilotState,
  };
}

export async function sourceAdmissionBlock(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  source: typeof discoverySourceTable.$inferSelect | undefined, now = new Date(),
) {
  const transportUntil = await sourceTransportCooldownUntil(tx, source, now);
  const access = collectionBlock(source, now, transportUntil);
  if (access) return access;
  const requests = await tx.select().from(discoveryRequestsTable).where(and(
    eq(discoveryRequestsTable.sourceId, "UJS"),
    or(gt(discoveryRequestsTable.startedAt, new Date(now.getTime() - 86_400_000)), eq(discoveryRequestsTable.outcome, "IN_FLIGHT")),
  ));
  if (source?.activeRequestId || requests.some((request) => request.outcome === "IN_FLIGHT")) return "REQUEST_IN_FLIGHT";
  return rollingUsage(requests.map((request) => request.startedAt), now, discoveryPolicy.hourlyRequestCap, discoveryPolicy.dailyRequestCap).blockedReason;
}
