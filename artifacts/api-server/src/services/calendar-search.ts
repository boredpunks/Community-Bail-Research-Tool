import { db, discoveryItemsTable, discoverySourceTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { calendarAdmission } from "../lib/research-operations";
import { sourceTransportCooldownUntil } from "../lib/transport-cooldown";
import { transportStopDescription } from "../lib/discovery-safety";

/** Admission is a runtime safety decision, not a claim of historical proof. */
export async function calendarSearchReadiness(ownerIds: string[]) {
  const now = new Date();
  const [[count], [source]] = await Promise.all([
    db.select({ value: sql<number>`count(distinct ${discoveryItemsTable.docketNumber})::integer` })
      .from(discoveryItemsTable).where(inArray(discoveryItemsTable.ownerId, ownerIds)),
    db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")),
  ]);
  const blocked = await calendarAdmission(db, source);
  const transportUntil = await sourceTransportCooldownUntil(db, source, now);
  const nextEligibleAt = blocked && transportUntil && transportUntil > now
    ? transportUntil.toISOString()
    : null;
  const blockedDescription = transportStopDescription(source?.blockedReason)
    ?? (blocked ? `The current source safeguard is ${blocked.toLowerCase().replaceAll("_", " ")}.` : null);
  return {
    calendarVerified: false,
    liveAvailable: !blocked,
    evidence: null,
    reason: blocked
      ? `Live calendar search is temporarily unavailable. ${blockedDescription}${nextEligibleAt ? ` Expected to be available after ${nextEligibleAt}.` : ""} You can still search collected workspace evidence.`
      : "Live calendar search is available for the selected calendar filters. Source access, quotas, and pacing can still pause a search.",
    scope: "Live calendar searches use the selected court office, event type, and hearing dates. Bail amounts are extracted from associated docket evidence when available; incomplete coverage remains explicit.",
    authScope: "signed-in session",
    collectedDockets: count?.value ?? 0,
    nextEligibleAt,
  };
}
