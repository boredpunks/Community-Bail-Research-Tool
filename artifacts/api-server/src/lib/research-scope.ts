import { actualDate } from "./calendar-criteria";

// Explicit operator-only scope authorized October 18, 2026. No web collection
// enablement, inherited permits, retries, or changes to regular operator caps.
export const researchMethod = "title-calendar+urllib-mdj-research-v1";
export const proofMethod = "urllib-explicit-document-regression-v1";
export const researchSpacingMs = 2000;
export const proofDockets = [
  "MJ-05003-CR-0004964-2026", "MJ-05003-CR-0005460-2026",
  "MJ-05003-CR-0004796-2026", "CP-02-CR-0005298-2024",
] as const;
export const proofUrls = proofDockets.map(docket =>
  `https://ujsportal.pacourts.us/Report/${docket.startsWith("MJ-") ? "Mdj" : "Cp"}DocketSheet?docketNumber=${docket}`);
export function validResearchCriteria(value: unknown, proof = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  const keys = ["courtOffice", "courtRoom", "eventType", "calendarPreviewOnly", "startDate",
    "endDate", "recordCap", "requestCap", "matchTarget", "matchFilters", ...(proof ? [] : ["proofPermitId"])];
  const f = c.matchFilters as Record<string, unknown> | undefined;
  return Object.keys(c).sort().join() === keys.sort().join()
    && c.courtOffice === "ANY" && c.courtRoom === "ANY" && c.eventType === "ANY"
    && c.calendarPreviewOnly === false && actualDate(c.startDate) && c.endDate === c.startDate
    && ![0, 6].includes(new Date(`${c.startDate}T12:00:00Z`).getUTCDay())
    && c.recordCap === (proof ? 4 : 146) && c.requestCap === (proof ? 4 : 150)
    && c.matchTarget === 3 && f && Object.keys(f).sort().join()
      === ["excludeShownPosted", "inclusiveMaximum", "monetaryUpperBoundCents", "requirePostedNotShown"].sort().join()
    && f.monetaryUpperBoundCents === 100000 && f.excludeShownPosted === true
    && f.inclusiveMaximum === true && f.requirePostedNotShown === true
    && (proof || typeof c.proofPermitId === "string" && /^[\da-f-]{36}$/i.test(c.proofPermitId));
}
export function makeResearchCriteria(day: string, proofPermitId?: string) {
  const proof = proofPermitId === undefined;
  const criteria = { courtOffice: "ANY" as const, courtRoom: "ANY", eventType: "ANY" as const,
    calendarPreviewOnly: false, startDate: day, endDate: day,
    recordCap: proof ? 4 : 146, requestCap: proof ? 4 : 150, matchTarget: 3,
    matchFilters: { monetaryUpperBoundCents: 100000, excludeShownPosted: true, inclusiveMaximum: true, requirePostedNotShown: true },
    ...(proof ? {} : { proofPermitId }) };
  if (!validResearchCriteria(criteria, proof)) throw new Error("Invalid exact research scope");
  return criteria;
}
