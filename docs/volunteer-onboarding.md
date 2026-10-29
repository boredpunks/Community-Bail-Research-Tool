# Volunteer access and first-use guide

## Release status
This guide describes the Search → Review → Candidates workflow.
Publish the verified main branch before circulating the invitation. A working
existing production URL does not establish that these changes are already published.

## Access
Open https://community-bail-research-tool.replit.app/search .
Ask the workspace coordinator for the shared password through a separate, trusted
channel. Never forward passwords in the invitation, export, or feedback form.
The shared password does not create individual volunteer accounts.

## First search
1. Open **Search**. Choose hearing start, hearing end, and maximum recorded bail.
   The window must start today or later and cover at most seven days. Optional
   Settings contains the supported court office and calendar event.
2. Click **Search** below the settings to launch the live court search.
3. Raw, unfiltered rows appear below the button: row number, docket, hearing date,
   and bail amount when available. Missing amounts are not zero amounts.
4. **Review** automatically shows matching results from this search as they arrive.
   Each row contains the docket, bail amount, and source-PDF citation when available.
5. Mark a Review row **Candidate** to save it to the shared **Candidates** page.
   Everyone with workspace access can see saved candidates. Missing or unverified
   evidence cannot be silently promoted into a verified saved observation.
6. Launching a new search replaces the displayed Search and Review results.
   Candidates remain saved. If a launch is rejected, the previous results remain.

A match or candidate marking does not establish custody, release eligibility,
the applicable order, or an amount payable.

## Paused searches
- **Evidence needed:** review the checked results now; obtain verified missing
  evidence before starting another search. Repeated retries cannot create PDFs.
- **Wait until a time:** results remain available; continue only when offered.
- **Source blocked:** preserve results and contact the coordinator rather than
  repeatedly retrying or bypassing access restrictions.
- **New search required:** enter the hearing dates and amount on Search and launch
  a new run. A successful new launch stops the previous run from this session.

The latest search is tied to the current signed-in session, not an individual
account. Locking the workspace or session expiry ends access to private searches;
explicitly saved candidates remain in the shared workspace.

## Tell us what you actually need
Open https://community-bail-research-tool.replit.app/feedback .
Answer:
- What were you trying to do?
- What got in the way?
- What do you need next?

Feedback is visible to people with workspace access. Do not include names, docket
numbers, sensitive case facts, passwords or contact details. Report what happened
in your own words; this form is for real volunteer needs, not eligibility review.

## Coordinator release checklist
- Confirm main contains the verified workflow and publish the update.
- Apply the additive database schema changes through the publishing flow.
- Verify the three-page workflow and source readiness without sending court
  requests solely for interface testing. Development records are not automatically
  production data; an empty production list must remain empty.
- Send the invitation only after the updated release is reachable.
- Deliver the shared password separately.
- Review actual feedback with volunteers before choosing further features.
