/** Shared collection, display, and export semantics. No source transport here. */
export interface BailEntry {
  action: string;
  wording: string;
  orderDate: string | null;
  bailCategory: string;
  financialBasis: string | null;
  amountCents: number | null;
  sourceEntryId?: string;
  percentageCondition?: string | null;
  sourcePages?: number[];
}
export interface MatchingEvent {
  eventDate: string;
  eventType: string;
  eventTime?: string | null;
  sourceId?: string | null;
  sourcePage?: number;
}
export interface MonetaryFilters {
  monetaryUpperBoundCents?: number | null;
  monetaryLowerBoundCents?: number | null;
  excludeShownPosted?: boolean;
  inclusiveMaximum?: boolean;
  requirePostedNotShown?: boolean;
}
export interface BailProvenance {
  extractionOutcome: string;
  postedEntryState: string;
  entries: BailEntry[];
  eventDate: string | null;
  eventType: string;
  matchingEvents?: MatchingEvent[];
  pdfEvents?: MatchingEvent[];
}
export function isMonetarySetting(entry: BailEntry): boolean {
  return entry.bailCategory === "MONETARY"
    && ["TOTAL_BAIL", "RECORDED_BAIL_AMOUNT"].includes(entry.financialBasis ?? "")
    && Number.isSafeInteger(entry.amountCents) && entry.amountCents! >= 0
    && /^(?:set(?:\s*\(bail modification\))?|bail set|changed|modified|increased|reduced)$/i.test(entry.action.trim());
}
export function qualifyingEntries(p: BailProvenance, filters: MonetaryFilters = {}): BailEntry[] {
  if (p.extractionOutcome !== "EXTRACTED"
    || filters.excludeShownPosted && p.postedEntryState === "SHOWN_POSTED"
    || filters.requirePostedNotShown && p.postedEntryState !== "NOT_SHOWN") return [];
  const seen = new Set<string>();
  return p.entries.filter(entry => {
    if (!isMonetarySetting(entry)) return false;
    const cents = entry.amountCents!;
    if (filters.monetaryLowerBoundCents != null && cents < filters.monetaryLowerBoundCents) return false;
    if (filters.monetaryUpperBoundCents != null && (filters.inclusiveMaximum === false
      ? cents >= filters.monetaryUpperBoundCents : cents > filters.monetaryUpperBoundCents)) return false;
    const key = entry.sourceEntryId ?? JSON.stringify([
      entry.action.trim().toLowerCase(), entry.orderDate, entry.bailCategory,
      entry.amountCents, entry.financialBasis, entry.percentageCondition ?? null,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const canonicalDate = (value: string | null): value is string =>
  value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const normalizedTime = (value?: string | null) => (value ?? "").replace(/\s/g, "").toLowerCase();
const normalizedType = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
export function matchingEvents(p: BailProvenance): MatchingEvent[] {
  const events = p.matchingEvents ?? (p.eventDate
    ? [{ eventDate: p.eventDate, eventType: p.eventType }] : []);
  const seen = new Set<string>();
  return events.filter(event => {
    if (!canonicalDate(event.eventDate) || !event.eventType.trim() || event.eventType === "ANY") return false;
    const key = JSON.stringify([event.eventDate, normalizedType(event.eventType),
      normalizedTime(event.eventTime), event.sourceId ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function eventConflict(event: MatchingEvent, p: BailProvenance): boolean {
  const corresponding = (p.pdfEvents ?? []).filter(pdf =>
    normalizedType(pdf.eventType) === normalizedType(event.eventType)
    && (!pdf.eventTime || !event.eventTime || normalizedTime(pdf.eventTime) === normalizedTime(event.eventTime)));
  return corresponding.length > 0 && !corresponding.some(pdf => pdf.eventDate === event.eventDate);
}
export interface ResearchItem {
  id: string;
  docketNumber: string;
  sourceUrl: string;
  provenance: BailProvenance;
}
export interface QualifyingRow {
  key: string;
  itemId: string;
  docketNumber: string;
  sourceUrl: string;
  hearingDate: string;
  amountCents: number;
  event: MatchingEvent;
  entry: BailEntry;
  entryIndex: number;
}
export function projectQualifyingRows(items: ResearchItem[], filters: MonetaryFilters = {}): QualifyingRow[] {
  const rows: QualifyingRow[] = [];
  for (const item of items) {
    const entries = qualifyingEntries(item.provenance, filters);
    for (const event of matchingEvents(item.provenance)) {
      if (eventConflict(event, item.provenance)) continue;
      entries.forEach((entry, index) => rows.push({
        key: JSON.stringify([item.id, event, entry.sourceEntryId ?? index]),
        itemId: item.id, docketNumber: item.docketNumber, sourceUrl: item.sourceUrl,
        hearingDate: event.eventDate, amountCents: entry.amountCents!, event, entry,
        entryIndex: item.provenance.entries.indexOf(entry),
      }));
    }
  }
  return rows;
}
export function matchesMonetaryResearch(p: BailProvenance, filters: MonetaryFilters = {}): boolean {
  return qualifyingEntries(p, filters).length > 0
    && matchingEvents(p).some(event => !eventConflict(event, p));
}
const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
export function qualifyingRowsCsv(rows: QualifyingRow[]): string {
  return "Hearing date,Docket number,Bail amount\r\n"
    + rows.map(row => [csvCell(row.hearingDate), csvCell(row.docketNumber),
      (row.amountCents / 100).toFixed(2)].join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}
