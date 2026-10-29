import { db, discoveryItemsTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

/** Admission is a runtime safety decision, not a claim of historical proof. */
export async function calendarSearchReadiness(ownerIds: string[]) {
  const [count] = await db.select({ value: sql<number>`count(distinct ${discoveryItemsTable.docketNumber})::integer` })
    .from(discoveryItemsTable).where(inArray(discoveryItemsTable.ownerId, ownerIds));
  return {
    calendarVerified: false,
    liveAvailable: false,
    evidence: null,
    reason: "Live calendar discovery coming soon. This volunteer page searches collected calendar records and locally available evidence, not all court dockets.",
    scope: "Collected workspace calendar records filtered by hearing date; documents may still be missing. The collected count is not the number with usable bail evidence.",
    authScope: "signed-in session",
    collectedDockets: count?.value ?? 0,
  };
}
