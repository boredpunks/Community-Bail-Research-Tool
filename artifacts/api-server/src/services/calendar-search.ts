import { db, discoverySourceTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { calendarAdmission } from "../lib/research-operations";

/** Admission is a runtime safety decision, not a claim of historical proof. */
export async function calendarSearchReadiness() {
  const [source] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
  const block = await calendarAdmission(db, source);
  return {
    calendarVerified: false,
    liveAvailable: !block,
    evidence: null,
    reason: block
      ? `Live search is currently paused: ${block}. Saved evidence remains available.`
      : "Live searches may start under existing source safeguards. The cached six-docket proof did not verify live calendar or PDF access.",
    scope: "Live: Bail Hearing, all supported offices, any room, today or later, at most seven days. Saved: existing workspace calendar evidence only.",
    authScope: "signed-in session",
  };
}
