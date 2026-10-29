import type { BailSearchCriteria, DiscoveryItemRow } from "@workspace/db";

/** Calendar dates from an item that still satisfy the user's saved search. */
export function resultDatesForItem(criteria: BailSearchCriteria, item: Pick<DiscoveryItemRow, "provenance">): string[] {
  const provenance = item.provenance;
  const events = provenance.matchingEvents?.length
    ? provenance.matchingEvents
    : [{ eventDate: provenance.eventDate, eventType: provenance.eventType }];
  return [...new Set(events
    .filter(event => !!event.eventDate && event.eventDate >= criteria.startDate && event.eventDate <= criteria.endDate
      && (!criteria.eventType || event.eventType === criteria.eventType))
    .map(event => event.eventDate!))];
}
