// Public options observed October 12, 2026. See docs/court-coverage-inspection.md.
// These are form choices, not evidence of submitted-search or PDF coverage.
export const calendarOffices = ["CP-05-02-Crim", "CP-05-02-Fam", "CP-05-02-Juv"] as const;
export const calendarEvents = ["Bail Hearing", "Preliminary Arraignment"] as const;
export const CALENDAR_ANY = "ANY" as const;

export function actualDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function easternToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// The parser sends canonical dates, not source display text. Calendar previews
// require an event date; legacy regular checkpoints may have a missing date.
export function validCalendarRowDates(
  row: { eventDate: unknown; filingDate: unknown },
  criteria: { startDate: string; endDate: string },
  requireEventDate: boolean,
): boolean {
  return (row.eventDate === null
    ? !requireEventDate
    : actualDate(row.eventDate) && row.eventDate >= criteria.startDate && row.eventDate <= criteria.endDate)
    && (row.filingDate === null || actualDate(row.filingDate));
}

export function validCalendarCriteria(value: {
  courtOffice?: unknown; eventType?: unknown; startDate?: unknown; endDate?: unknown;
}, minimumDate?: string): boolean {
  return calendarOffices.includes(value.courtOffice as typeof calendarOffices[number])
    && calendarEvents.includes(value.eventType as typeof calendarEvents[number])
    && actualDate(value.startDate) && actualDate(value.endDate)
    && (!minimumDate || value.startDate >= minimumDate)
    && value.endDate >= value.startDate
    && Date.parse(value.endDate) - Date.parse(value.startDate) <= 6 * 86_400_000;
}

export function validCalendarPreviewCriteria(value: {
  courtOffice?: unknown; eventType?: unknown; courtRoom?: unknown; startDate?: unknown; endDate?: unknown;
}, minimumDate?: string): boolean {
  const publicChoice = (v: unknown) => typeof v === "string" && v.trim().length > 0
    && v.length <= 80 && !/[\u0000-\u001f\u007f<>]/.test(v);
  const officeValid = publicChoice(value.courtOffice);
  const eventValid = publicChoice(value.eventType);
  const roomValid = value.courtRoom === undefined || publicChoice(value.courtRoom);
  const unfiltered = value.courtOffice === CALENDAR_ANY
    && value.courtRoom === CALENDAR_ANY && value.eventType === CALENDAR_ANY;
  return officeValid && eventValid && roomValid
    && actualDate(value.startDate) && actualDate(value.endDate)
    && (!minimumDate || value.startDate >= minimumDate)
    && value.endDate >= value.startDate
    && Date.parse(value.endDate) - Date.parse(value.startDate) <= (unfiltered ? 0 : 6) * 86_400_000;
}

export function makeCalendarPreviewCriteria(input: {
  courtOffice?: unknown; eventType?: unknown; startDate?: unknown; endDate?: unknown; courtRoom?: unknown;
}, minimumDate = easternToday()) {
  const normalized = { ...input, courtRoom: input.courtRoom ?? CALENDAR_ANY };
  if (!validCalendarPreviewCriteria(normalized, minimumDate)) {
    throw new Error("INVALID_CALENDAR_CRITERIA: Choose no-filter or observed office/event criteria, keep the all-filter-blank scope to one day, and use real today-or-future dates covering at most seven days. No substitution.");
  }
  return {
    courtOffice: input.courtOffice as string,
    eventType: input.eventType as string,
    calendarPreviewOnly: true,
    courtRoom: normalized.courtRoom as string,
    startDate: input.startDate as string,
    endDate: input.endDate as string,
    recordCap: 1,
    requestCap: 8,
  };
}
