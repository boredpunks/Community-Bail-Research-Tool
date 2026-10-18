import { eq, inArray } from "drizzle-orm";
import { db, discoveryAssessmentsTable as permits, discoveryJobsTable as jobs, discoverySourceTable as sources } from "@workspace/db";
import { discoveryPolicy, easternToday } from "./discovery";
import { calendarPreviewSourceAllowed } from "./discovery-safety";
import { boundedEngineMethod, validBoundedEngineCriteria } from "./bounded-engine";

/** Uses stored criteria only. The authenticated app cannot grant approvals. */
export async function launchBoundedPermit(ownerId: string, id: string, store = db, now = new Date()) {
  return store.transaction(async tx => {
    const [source] = await tx.select().from(sources).where(eq(sources.id, "UJS")).for("update");
    const [permit] = await tx.select().from(permits).where(eq(permits.id, id)).for("update");
    if (!permit || permit.executionOwnerId !== ownerId) {
      return { status: 404 as const, error: "Approved scope not found for this workspace." };
    }
    if (permit.stage !== "BOUNDED_ENGINE" || permit.expectedMethod !== boundedEngineMethod
      || !validBoundedEngineCriteria(permit.criteria) || permit.criteria.startDate < easternToday()
      || permit.criteria.recordCap > discoveryPolicy.maxRecordCap || permit.criteria.requestCap > discoveryPolicy.maxRequestCap
      || permit.state !== "APPROVED" || permit.jobId || !permit.approvedAt || !permit.expiresAt || permit.expiresAt <= now
      || !source || !calendarPreviewSourceAllowed(source)
      || source.pausedUntil && source.pausedUntil > now) {
      return { status: 409 as const, error: "This exact scope is not currently launchable. No permit was reused and no source request was sent." };
    }
    const [active] = await tx.select({ id: jobs.id }).from(jobs)
      .where(inArray(jobs.status, ["QUEUED", "RUNNING"])).limit(1);
    if (active) return { status: 409 as const, error: "Another source job is active. No new job was launched." };
    const [job] = await tx.insert(jobs).values({
      ownerId, assessmentId: permit.id, criteria: permit.criteria,
      message: "One exact operator-approved bounded scope queued from the app. Global source barrier unchanged.",
    }).returning();
    await tx.update(permits).set({ state: "ATTEMPTED", jobId: job!.id, startedAt: now })
      .where(eq(permits.id, permit.id));
    return { status: 201 as const, job: job! };
  });
}
