import { actualDate, easternToday } from "./calendar-criteria";
import { integratedSourceMethod } from "./discovery-safety";

// A scoped assessment, never collection enablement or global access proof.
export const boundedEngineMethod = `${integratedSourceMethod}-bounded-506-v5`;
export const boundedEngineRequestCap = 12;
export const boundedEngineObservationRequestCap = 3;
const keys = ["courtOffice", "courtRoom", "eventType", "startDate", "endDate", "recordCap", "requestCap"];

export function boundedObservationCanContinue(outcome: unknown, requestsUsed: number) {
  return outcome === "BOUND_506" && Number.isSafeInteger(requestsUsed)
    && requestsUsed >= 1 && requestsUsed <= boundedEngineObservationRequestCap;
}

export function boundedObservationRequestAllowed(
  observationComplete: boolean, requestsUsed: number, path: unknown, method: unknown,
) {
  if (observationComplete) return true;
  return Number.isSafeInteger(requestsUsed) && requestsUsed >= 0
    && requestsUsed < boundedEngineObservationRequestCap && method === "GET"
    && ["/CaseSearch", "/resource/css/sitemain.min.css", "/resource/js/sitemain.min.js"].includes(String(path));
}

export function boundedEngineRequestsRemaining(requestsUsed: number) {
  return Number.isSafeInteger(requestsUsed) && requestsUsed >= 0 && requestsUsed <= boundedEngineRequestCap
    ? boundedEngineRequestCap - requestsUsed : 0;
}

export function validBoundedEngineCriteria(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return Object.keys(c).sort().join() === [...keys].sort().join()
    && c.courtOffice === "CP-05-02-Crim" && c.courtRoom === "Courtroom 506"
    && c.eventType === "Bail Hearing" && c.recordCap === 5 && c.requestCap === boundedEngineRequestCap
    && actualDate(c.startDate) && actualDate(c.endDate) && c.endDate >= c.startDate
    && Date.parse(c.endDate) - Date.parse(c.startDate) <= 6 * 86_400_000;
}
export function makeBoundedEngineCriteria(startDate: unknown, endDate: unknown) {
  const criteria = { courtOffice: "CP-05-02-Crim" as const, courtRoom: "Courtroom 506",
    eventType: "Bail Hearing" as const, startDate: String(startDate ?? ""), endDate: String(endDate ?? ""),
    recordCap: 5, requestCap: 12 };
  if (!validBoundedEngineCriteria(criteria) || criteria.startDate < easternToday())
    throw new Error("Bounded engine requires exact Courtroom 506 criteria and today/future dates, at most seven days.");
  return criteria;
}
