# Volunteer search calendar readiness

Live calendar discovery is **not verified**. The calendar-reliability task remains
unfinished. Its scoped authorized date (2026-10-28) is now in the past; no replacement
date, court, office, event, or room has been substituted and no live probe was run
as part of volunteer-search integration.

The six-docket proof establishes local extraction from validated cached PDFs,
not current calendar submission, pagination coverage, or deployed PDF access.

Task status is not a runtime admission gate. At the user's direction, the volunteer
page can start the existing calendar service under its actual source safeguards.
A separate, explicitly selected saved-evidence mode searches existing
workspace calendar rows and already stored extraction evidence or cached PDFs.
It never performs a court request or treats its coverage as live/current.

Live criteria are chosen explicitly on submission: hearing dates, Bail Hearing,
all supported offices, any room. The existing source admission, pacing, document
verification, budget and cooldown policies remain authoritative. No live acceptance
claim follows from the six-docket cached run. The first actual search may pause
with a source-access or transport failure; partial results remain available.

## Authentication boundary

The current application uses a shared workspace password. It does not have
individual volunteer account identities. New search IDs are private to the
existing signed-in session, using a server-derived keyed identifier; a different
valid session cannot read, resume, list, or export them. Restarting the API does
not invalidate that session or delete its database results. Locking/re-entering
the workspace creates a new session, so previous private searches are not
automatically accessible. True account-level isolation across sign-ins remains
unimplemented; this is not represented as per-user account security.
