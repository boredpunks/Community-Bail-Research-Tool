import { and, desc, eq } from "drizzle-orm";
import {
  db, discoveryEventsTable, discoveryJobsTable, discoveryRequestsTable, discoverySourceTable,
} from "@workspace/db";
import { WORKSPACE_OWNER_ID } from "../middlewares/researchAuth";

type Store = typeof db;

export async function clearSourceValidationBarrier(
  input: { reason: string; userApproved: boolean; operator?: string },
  context: { store?: Store; now?: () => Date } = {},
) {
  if (!input.userApproved) throw new Error("Explicit --user-approved confirmation is required; source state is unchanged.");
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000) {
    throw new Error("Provide a non-empty --reason of at most 1000 characters; source state is unchanged.");
  }
  const operator = input.operator ?? WORKSPACE_OWNER_ID;
  if (!operator) throw new Error("Operator identity is unavailable; source state is unchanged.");

  const store = context.store ?? db;
  return store.transaction(async (tx) => {
    const [source] = await tx.select().from(discoverySourceTable)
      .where(eq(discoverySourceTable.id, "UJS")).for("update");
    if (!source) throw new Error("Source state is missing; no barrier was cleared.");
    if (source.blockedReason !== "SOURCE_VALIDATION_BARRIER") {
      throw new Error("Only SOURCE_VALIDATION_BARRIER can be cleared with this command; source state is unchanged.");
    }
    if (source.activeRequestId) throw new Error("A source request is active; no barrier was cleared.");

    const [inFlight] = await tx.select({ id: discoveryRequestsTable.id }).from(discoveryRequestsTable)
      .where(and(eq(discoveryRequestsTable.sourceId, "UJS"), eq(discoveryRequestsTable.outcome, "IN_FLIGHT")))
      .limit(1);
    if (inFlight) throw new Error("A source request is active; no barrier was cleared.");

    const now = context.now?.() ?? new Date();
    if (source.pausedUntil && source.pausedUntil > now) {
      throw new Error("The source pause has not expired; no barrier was cleared.");
    }

    const [lastRequest] = await tx.select().from(discoveryRequestsTable)
      .where(eq(discoveryRequestsTable.sourceId, "UJS"))
      .orderBy(desc(discoveryRequestsTable.startedAt)).limit(1);
    if (!lastRequest) throw new Error("No retained request exists to anchor the audit event; source state is unchanged.");
    const [job] = await tx.select().from(discoveryJobsTable)
      .where(eq(discoveryJobsTable.id, lastRequest.jobId)).limit(1);
    if (!job) throw new Error("The retained request has no audit job; source state is unchanged.");

    await tx.insert(discoveryEventsTable).values({
      jobId: job.id,
      ownerId: job.ownerId,
      kind: "SOURCE_BARRIER_CLEARED",
      message: JSON.stringify({
        timestamp: now.toISOString(),
        previousBlockedReason: source.blockedReason,
        reason: input.reason,
        operator,
      }),
    });
    await tx.update(discoverySourceTable).set({ blockedReason: null })
      .where(eq(discoverySourceTable.id, "UJS"));

    return {
      state: "CLEARED",
      previousBlockedReason: source.blockedReason,
      reason: input.reason,
      operator,
      timestamp: now.toISOString(),
      auditJobId: job.id,
      notice: "Only SOURCE_VALIDATION_BARRIER was cleared. The pause timestamp, access proof, collection approval, permits, and retained request/job history were not changed.",
    };
  });
}
