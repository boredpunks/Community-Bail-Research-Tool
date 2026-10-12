---
name: Calendar-first bail discovery
description: User-selected filing/calendar methods and interpretation of missing bail sections.
---

Let the user choose criminal filing-date discovery (the briefing method),
Calendar Events for Preliminary Arraignments, or Calendar Events for Bail
Hearing. Never silently switch methods, events, courts or dates after a failure.

**Why:** The user explicitly requested all three choices in the search engine.
Calendar-first targeting was an earlier preference, not permission to exclude
filing-date discovery or override the user's selection.

**How to apply:** Preserve the chosen method with jobs, progress, results and
saved provenance. Verify court/date coverage for each method independently.

Calendar-event discovery can target later bail proceedings instead of broad filings.

**Why:** The user explained: “The ones that don't have a bail section are because the defendant just got a citation without getting arrested. Sometimes they end up getting arraigned or having a bail hearing later in the case, sometimes their cases get settled first.”

**How to apply:** Verify the source's available event labels and court coverage, and query bounded event windows. Missing bail sections remain a distinct extraction outcome with unknown bail, not a zero amount or an automatic parser failure. The user's explanation is not evidence establishing the procedural history of every newly retrieved case.

Do not assume Calendar Events can reproduce historical filing-date windows.

**Why:** On October 6, 2026, the public form marked calendar start dates as future-only with that day's minimum. The briefing's historical filing-date selection is not interchangeable with upcoming calendar-event discovery.

**How to apply:** Recheck the live date restrictions before enabling discovery. Explain unsupported historical dates rather than silently substituting upcoming dates or filing-date searches.

The product searches for source-backed PDFs for community members whose current
incarceration is already known outside the court document. A past court document
may show the original docket. A future scheduled-hearing document is useful only
if its PDF already shows both the docket number and bail information.

**Why:** The user clarified that the research must support both historical
documents and potentially useful upcoming-hearing documents, without assuming
either date range contains a bail amount.

**How to apply:** Require both identifiers in the same retrieved source PDF;
never infer current custody from a docket, hearing, or bail amount. The current
pilot accepts only today/future dates and stops if the source form's minimum
excludes a requested date. Do not bypass that check; verify historical access
offline and obtain the exact scope and fresh approval before any source request.
