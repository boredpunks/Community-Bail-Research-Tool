import { and, eq, inArray, sql } from "drizzle-orm";
import { db, discoveryJobsTable, discoverySourceTable, type DiscoveryCriteriaData } from "@workspace/db";
import { actualDate, easternToday, validCalendarPreviewCriteria } from "./calendar-criteria";
import { discoveryPolicy, jobSummary } from "./discovery";
import { sourceAdmissionBlock } from "./discovery-source-status";
import { calendarAdmission } from "./research-operations";

export function criteriaIdentity(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(criteriaIdentity));
  if (value && typeof value === "object") return JSON.stringify(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, criteriaIdentity(val)]));
  return JSON.stringify(value);
}
export function newResearchCriteria(input: Record<string, unknown>): DiscoveryCriteriaData {
  const { startDate, endDate, courtOffice, eventType } = input;
  const courtRoom = input.courtRoom ?? "ANY";
  if (!validCalendarPreviewCriteria({ startDate, endDate, courtOffice, eventType, courtRoom }, easternToday())
    || !["Formal Arraignment", "Preliminary Hearing", "Bail Hearing", "Preliminary Arraignment"].includes(String(eventType))
    || !["ANY", "CP-05-02-Crim"].includes(String(courtOffice))
    || courtRoom !== "ANY" && courtRoom !== "Courtroom 506"
    || input.calendarPreviewOnly === true) throw new Error("Choose supported exact calendar criteria, today or later, covering at most seven days.");
  const recordCap = input.recordCap ?? discoveryPolicy.maxRecordCap;
  const requestCap = input.requestCap ?? discoveryPolicy.maxRequestCap;
  const matchTarget = input.matchTarget ?? 1;
  if (![recordCap, requestCap, matchTarget].every(Number.isSafeInteger)
    || Number(recordCap) < 1 || Number(recordCap) > discoveryPolicy.maxRecordCap
    || Number(requestCap) < 8 || Number(requestCap) > discoveryPolicy.maxRequestCap
    || Number(matchTarget) < 1 || Number(matchTarget) > Number(recordCap)) {
    throw new Error("Matching target, record cap, and request cap must fit the current collection policy.");
  }
  const filters = input.matchFilters as Record<string, unknown> | undefined;
  const maximum = filters?.monetaryUpperBoundCents ?? null;
  const minimum = filters?.monetaryLowerBoundCents ?? null;
  if ([minimum, maximum].some(value => value !== null && (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2147483647))
    || minimum !== null && maximum !== null && Number(minimum) > Number(maximum)
    || filters?.excludeShownPosted !== undefined && typeof filters.excludeShownPosted !== "boolean") {
    throw new Error("Use a valid nonnegative monetary range in integer cents.");
  }
  return {
    resultVersion: 2, courtOffice: String(courtOffice), eventType: String(eventType),
    courtRoom: String(courtRoom), startDate: String(startDate), endDate: String(endDate),
    recordCap: Number(recordCap), requestCap: Number(requestCap), matchTarget: Number(matchTarget),
    matchFilters: { monetaryUpperBoundCents: maximum as number | null,
      monetaryLowerBoundCents: minimum as number | null,
      excludeShownPosted: filters?.excludeShownPosted === true, inclusiveMaximum: true },
  };
}

export async function launchDiscovery(criteria: DiscoveryCriteriaData, ownerId: string, ownerIds: string[]) {
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(74651284)`);
    const active = await tx.select().from(discoveryJobsTable).where(and(
      inArray(discoveryJobsTable.ownerId, ownerIds), inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])));
    const duplicate = active.find(job => criteriaIdentity(job.criteria) === criteriaIdentity(criteria));
    if (duplicate) return { job: duplicate };
    if (active.length) return { error: "Pause or finish the active research job before starting another.", status: 409 };
    const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
    // Discovery may proceed even while the separate document client is blocked.
    // The request scheduler still denies every unverified PDF transmission.
    const block = await calendarAdmission(tx, source);
    if (block) return { error: `Collection blocked: ${block}. Existing evidence is retained.`, status: 409 };
    const [job] = await tx.insert(discoveryJobsTable).values({ ownerId, criteria,
      message: "Queued with fixed calendar criteria, monetary filters, target, and budgets." }).returning();
    return { job: job! };
  });
  return result.job ? { payload: await jobSummary(result.job), status: 201, error: undefined }
    : {payload: undefined, error: result.error, status: result.status};
}
