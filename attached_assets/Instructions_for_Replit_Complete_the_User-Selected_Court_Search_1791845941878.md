# Instructions for Replit: Complete the User-Selected Court Search

Paste this whole document into the Replit agent. Work through the phases in order. Each phase has a gate. Do not start a phase until the previous gate is met and the user has approved the next permit.

---

## Standing rules (apply to every phase)

1. Never invent, simulate or fill in docket entries, cases, hearings, court offices, codes, field labels, endpoints or search parameters. If something has not been observed on the live public source in this method version, it does not exist for the app.
2. Synthetic fixtures may exist only in offline tests. They must be labeled synthetic, kept out of every user-facing view, and never mixed with source results.
3. Every request to the court source needs a single-use permit that is prepared in advance, shown to the user, and explicitly approved. The permit must state:
   - the maximum number of requests;
   - the allowed request methods (GET or POST);
   - the maximum number of PDFs;
   - the exact page actions allowed.
4. Keep the existing source-stop state (`SOURCE_VALIDATION_BARRIER`) until a phase gate explicitly clears it with evidence. Never clear it just to make progress.
5. Leave at least 60 seconds between one response finishing and the next request starting. Stop the run permanently on any of these: HTTP 403, HTTP 429, a CAPTCHA, a login prompt, an unexpected redirect, or a response that isn't the expected content type. Do not retry in the same run. Do not use proxies, stealth tooling or identity rotation.

   For context, an earlier exploratory session got HTTP 429 after about 44 PDF requests spaced about 5 seconds apart.
6. Stop the managed API workflow before each command-line source inspection and restart it afterward, as now.
7. Keep only:
   - docket numbers;
   - court and county as displayed;
   - the method version and permit ID;
   - request-ledger entries;
   - timestamps with time zone;
   - bail and hearing fields as written on the source.

   Never keep or log names, birth dates, addresses, charges, surety names, or the full text of PDFs.
8. Fail closed. When a control, label, code or result is missing, ambiguous, oversized or unrecognized, report that state and stop. Never guess.
9. The run status `INSPECTED` means only that the protocol finished. Only claim that a search, an office or a document is verified when the specific evidence for it is in the report.
10. Bump the method identifier (currently `playwright-filing-control-inventory-v7`) whenever recognition, selection or submission logic changes. A report made with an older method never authorizes a run under a newer one.

---

## Phase 1 — Identify what the 49 office choices are

Goal: find out from evidence, not guesswork, what the 49-choice dropdown shows to a person.

1. Ask the user for one redacted example. A screenshot, or a typed copy, of:
   - the dropdown's visible field label;
   - one visible option from it, with any personal name blacked out.

   Wait for a real answer. If the question gets cancelled, ask again. Do not proceed on an empty response.
2. Lead to verify, not a fact: an earlier, separate session (October 5, 2026) saw this control's accessibility name as "MDJS Court Office". It was disabled until a county was selected. Its options were not recorded. Compare this against the user's example and the current page. Do not treat it as confirmed.
3. If the user can't provide an example, prepare a new permit (v8 method) that allows reading only these, for the single candidate control:
   - the accessibility-tree name of each option, or its `option.label`;
   - capped at 2,000 options;
   - zero POSTs and zero PDFs;
   - no selection.

   It must keep:
   - the option count;
   - for each option, the displayed text, redacted where it looks like a person's name: two or more capitalized words with no digits, which matches judge names;
   - the field label.
4. Add `MDJS Court Office` to the closed field-label vocabulary only if the observed label matches it exactly. Record which evidence source supports it.
5. Change the code recognizer only to match a format you actually observed. Write a fixture that reproduces the observed displayed format, with names redacted. Rerun the focused office-identification test, the build and `git diff --check`.

Gate 1: the report shows:
- the exact field label;
- a count of recognized codes greater than 0;
- each recognized code classified as `EXPLICIT_MDJ` or `DISTRICT_CODE_UNVERIFIED`, with no unexplained unrecognized choices.

If the displayed choices contain no codes at all, for example only office names, record that, and treat the displayed office name as the identifier the user will choose. Get the user's agreement on this before Phase 2.

---

## Phase 2 — Establish the criminal and MDJ context

Goal: prove the search will cover criminal Magisterial District Court cases, using what the page shows rather than hidden controls.

1. Record whether the Docket Type control becomes visible or enabled after the county or office is chosen, in each phase snapshot. Do not treat the word "Criminal" elsewhere on the page as evidence.
2. If no docket-type control exists, propose verifying criminal scope from the results themselves: docket numbers displayed in the `MJ-#####-CR-#######-YYYY` form.

   That format was seen in the earlier session, but it is unverified for this app. Confirm it in Phase 3, or reject it.
3. Get explicit user approval for whichever criminal-scope rule you'll use, before any search is submitted.

Gate 2: a written, user-approved rule for criminal and MDJ scope, tied to observed page evidence.

---

## Phase 3 — First user-selected filing-date search (one submission)

Goal: one real search, end to end, with every element verified.

1. The user chooses all of these in the app: county (Allegheny), office (from the Phase 1 list), and a filing-date range. The agent selects nothing on its own.
2. Before submitting, observe how Search actually sends the request, GET or POST, and the field names. Record the observed method and field names in the report. Do not hard-code any parameter you haven't observed. If it is a POST, the permit must allow exactly one.
3. New permit:
   - one search submission plus the page loads it requires;
   - a maximum of 3 requests;
   - zero PDFs;
   - 60-second spacing.
4. After submitting, record:
   - the number of result rows;
   - whether results appear to be capped or truncated, for example many rows that all share one date across a multi-day range, or a hard row ceiling;
   - each result's docket number, court type, county, filing date and case status as displayed.

   Record no names or birth dates.
5. Check the results against the request:
   - every row's county and filing date fall inside what the user selected;
   - every row's docket number matches the selected office and the Phase 2 criminal rule.

   Any mismatch counts as a failed search, not partial success.

Gate 3: a report with the observed request method and fields, the selected bindings, the row count, the truncation check, and a pass result on the result-matching check.

At this point the task "Complete user-selected court search" can be marked complete for filing-date search only.

---

## Phase 4 — Hearing calendars (Preliminary Arraignment and Bail Hearing)

1. Observe the Calendar Event search mode:
   - its date fields;
   - the Calendar Event Type dropdown;
   - the Scheduled Events Only checkbox.

   The earlier session saw these, but they are unverified for this app.
2. Record the exact visible labels of the event-type options that refer to preliminary arraignment and bail hearing. The list contains many near-duplicates, so use only exact labels, chosen by the user.
3. Repeat Phase 3's steps with the Calendar Event search: one user-chosen event type, county, office and date range; one submission under a new permit; the same result-matching checks, including event type, event date and event status as displayed.

Gate 4: one verified calendar search for each event type, or a documented barrier.

---

## Phase 5 — Docket-sheet PDF retrieval and extraction (only if the user approves collection)

1. A separate permit that the user approves, raising the PDF limit above zero. Start with 3 PDFs at most, 60-second spacing, and a GET request only, through the result row's own docket-sheet link.
2. Verify each PDF:
   - its content type;
   - the docket number printed on the sheet matches the result row;
   - the sheet shows the court type and county.
3. Extract only the bail section, with columns located by their header positions: Bail Action Type, Bail Action Date, Bail Type, Originating Court, Percentage, Amount. Also extract whether a "Bail Posted" status appears, with no surety names.
4. Treat these as ambiguous, never as a clean result:
   - more than one bail action;
   - any Change, Modify or Revoke action;
   - a blank type.
5. Delete each PDF immediately after extraction. A person compares the first 3 extractions by hand against the PDF before any larger run is approved.
6. Never present an extracted bail amount as the amount needed for release, as custody status, or as eligibility for help. Dockets don't show custody, and no official online roster for Allegheny County Jail has been found.

Gate 5: three extractions checked by hand, with zero mismatches.

---

## Definition of done

The app may say "user-selected court search works end to end" only when all of these are true:

- Gates 1–3 are met under the current method version.
- The final report links permit ID, method version, request ledger, observed request method and fields, selected bindings, and result-matching checks.
- All offline checks pass: typecheck and build, the safety checks, the network-blocked tests, and the focused fixtures.
- No invented or synthetic data appears in any user-facing output.

Report Gates 4 and 5 separately as each one is met. Their status must not change the meaning of Gate 3.

---

## When to stop and ask the user

- Any phase gate fails twice.
- The site's layout, labels or request method differ from what was recorded.
- A rate limit, CAPTCHA or access warning appears.
- Any step would require selecting, entering or submitting something the user hasn't chosen.
