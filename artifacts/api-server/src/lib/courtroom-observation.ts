/** Narrow read-only intent carried by the existing COVERAGE permit/transport. */
import { actualDate, easternToday } from "./calendar-criteria";
import { coverageInspectionMethod } from "./coverage-inspection";

export const courtroomObservationMethod = "playwright-public-courtroom-observation-v2";
export const courtroomObservationDeadlineMs = 480_000;
const criteriaKeys = ["courtOffice", "courtRoom", "eventType", "startDate", "endDate", "recordCap", "requestCap"];

export function validCourtroomObservationCriteria(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const c = raw as Record<string, unknown>;
  return Object.keys(c).sort().join() === [...criteriaKeys].sort().join()
    && c.courtOffice === "CP-05-02-Crim" && c.eventType === "Bail Hearing"
    && c.courtRoom === "Courtroom 506" && c.recordCap === 1 && c.requestCap === 3
    && actualDate(c.startDate) && actualDate(c.endDate) && c.endDate >= c.startDate
    && Date.parse(c.endDate) - Date.parse(c.startDate) <= 6 * 86_400_000;
}

export function makeCourtroomObservationCriteria(startDate: unknown, endDate: unknown) {
  const criteria = { courtOffice: "CP-05-02-Crim" as const, courtRoom: "Courtroom 506",
    eventType: "Bail Hearing" as const, startDate: String(startDate ?? ""), endDate: String(endDate ?? ""),
    recordCap: 1, requestCap: 3 };
  if (!validCourtroomObservationCriteria(criteria) || criteria.startDate < easternToday())
    throw new Error("Use explicit today/future dates covering at most seven days; courtroom scope is fixed at Courtroom 506.");
  return criteria;
}

export function coverageMethod(criteria?: unknown) {
  return validCourtroomObservationCriteria(criteria) ? courtroomObservationMethod : coverageInspectionMethod;
}

const counts = ["labels", "controls", "options", "room506Options", "namedBindings"];
const flags = ["enabled", "sameForm", "busy", "room506Enabled", "room506Selected", "nativeMatches"];
const snapshotKeys = [...counts, ...flags];
export const courtroomObservationOutcomes = ["BOUND_506", "CONTROL_NOT_EXPOSED", "DEPENDENCY_UNRESOLVED",
  "ASSOCIATION_UNPROVEN", "AMBIGUOUS_PUBLIC_CONTROL", "ROOM_506_UNAVAILABLE", "BINDING_UNPROVEN"] as const;

function validSnapshot(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  return Object.keys(s).sort().join() === [...snapshotKeys].sort().join()
    && counts.every(key => Number.isSafeInteger(s[key]) && Number(s[key]) >= 0
      && Number(s[key]) <= (key === "options" ? 512 : key === "namedBindings" ? 32 : 2))
    && flags.every(key => typeof s[key] === "boolean");
}

export function validCourtroomObservationMetadata(m: Record<string, unknown>) {
  const keys = ["kind", "phase", "initial", "afterCriteria", "afterSelection", "outcome", "waitMs", "stable"];
  if (Object.keys(m).sort().join() !== keys.sort().join()
    || m.kind !== "courtroom_metadata" || m.phase !== "OBSERVED"
    || !courtroomObservationOutcomes.includes(m.outcome as typeof courtroomObservationOutcomes[number])
    || typeof m.stable !== "boolean" || !Number.isSafeInteger(m.waitMs)
    || Number(m.waitMs) < 0 || Number(m.waitMs) > 15_000
    || !validSnapshot(m.initial) || !validSnapshot(m.afterCriteria)
    || !(m.afterSelection === null || validSnapshot(m.afterSelection))) return false;
  const s = m.afterSelection as Record<string, unknown> | null;
  return m.outcome !== "BOUND_506" || !!s && m.stable === true
    && s.labels === 1 && s.controls === 1 && s.room506Options === 1 && s.namedBindings === 1
    && s.enabled === true && s.sameForm === true && s.busy === false
    && s.room506Enabled === true && s.room506Selected === true && s.nativeMatches === true;
}
