# Allegheny County Court Search Project — Revised Account

Revised October 12, 2026. This account covers two separate workstreams. Part A is the Replit app's court-search diagnostic. It is based on the summary you provided. I did not do that work, and I have not seen its code, request ledger or reports. Part B is the earlier exploratory work done in this conversation. Part C covers where the two conflict and what remains open. Paragraphs are numbered so the count can be checked.

---

## Part A — The Replit court-search diagnostic (as you reported it; not verified by me)

### Purpose and rules

1. The project researches criminal court records and hearings from public Pennsylvania court sources. Its purpose is to find and accurately describe real public records. It does not generate illustrative or stand-in case data.

2. Its central rule is that the app must never invent docket entries, cases or hearing records. Anything the app reports as a record must come from a real public source.

3. The broader goal includes finding three things: criminal filing-date searches, and the public calendars for Preliminary Arraignments and for Bail Hearings.

4. A search counts as useful only when everything about it has been verified: the source, the search method, the court context, the results, and any downloaded documents. Results from an unverified search can't be treated as evidence.

5. The assigned task, "Complete user-selected court search," is still in progress.

6. It has not yet reached the point of showing a user-selected court search working end to end.

### Finding the search controls

7. The first diagnostic work checked whether the public court website offers the controls needed to search by filing date.

8. That work found a Filing Date search mode.

9. It also found an Advanced Search control that could be observed and checked under tightly limited conditions.

10. Earlier evidence suggested that Advanced Search reveals a County control.

11. Later diagnostic work confirmed that the county you authorized, Allegheny, could be selected locally.

12. "Locally" is important. The approved selection changed what the page displayed, but it did not authorize sending the resulting search request to the court's server.

13. You approved this limited Allegheny selection after the agent asked.

### The five-phase inspection

14. The app then added an ordered inspection with five phases: `INITIAL`, `FILING`, `ADVANCED`, `COUNTY` and `FINAL`.

15. The phases let the report separate what was visible at the start from what appeared after each approved page change.

16. The inspection uses temporary browser handles to interact with the page controls.

17. Those handles are not kept as lasting identifiers for any court, case or office.

### What the diagnostic may and may not do

18. Within this diagnostic, the agent may select the Filing Date search mode.

19. It may check the exact, eligible Advanced Search checkbox.

20. It may select the exact "Allegheny" option in the eligible County control.

21. It may not select a court, an office, a case type, any other county, or a date.

22. It may not click Search.

23. It may not fetch PDFs or send a search request.

24. If an approved page change would trigger a follow-on request to the server, that request must be stopped locally and not sent.

25. These limits keep a diagnostic inspection from turning into an unapproved search or collection run.

26. The checks also keep the existing "source stopped" state in place. They don't clear it to force progress.

27. In the latest reported check, the source was in a `SOURCE_VALIDATION_BARRIER` state, meaning it had not yet passed validation.

### What the county change revealed

28. Before office identification was added, the approved work showed that choosing the county locally enabled and filled in a court-related dropdown.

29. In the inspected page state, that dropdown held 49 choices.

30. The app's fixed list of known field labels did not recognize the dropdown's exact institutional label.

31. The page observation did not show that this control represented the specific court or office the research needs.

32. It also did not establish an MDJ context.

33. "MDJ" means Magisterial District Judge, or a Magisterial District Court context.

34. A label that merely looks like an office name, or a numeric district code on its own, can't prove that context.

35. The same observation found the Docket Type control hidden or disabled.

36. The word "Criminal" appearing elsewhere on the page didn't prove the search would be limited to criminal cases.

37. So these observations did not establish a valid search path for criminal MDJ cases.

### Approval to identify public offices

38. You then approved "Allow public office identification."

39. That approval widened what the diagnostic could keep about the public-facing office control.

40. It covered limited institutional labels and district-office codes visibly shown on the page.

41. It did not allow the agent to select an office or to read and use hidden option values.

42. Names, free-form option text and identities were excluded from anything kept.

43. The approval also did not cover choosing a case category, entering dates, clicking Search, downloading PDFs or sending follow-on requests.

### How office candidates are identified

44. The app added an `officeIdentification` report object.

45. That object can record the number of eligible candidates, the candidate's position in that snapshot, its status, any displayed codes it recognized, and how many choices it didn't recognize.

46. The position number is diagnostic information only. It is not a lasting identity for the control, and it is never submitted to the server.

47. A control counts as a candidate only if it passes several page-state checks.

48. It must be a visible, enabled, standard dropdown.

49. It must belong to the search form and have a publicly displayed label.

50. That label must contain both a court-related word and an office-related word.

51. Even then, the code treats it only as a candidate to observe, not as a confirmed court-office control.

52. Missing, ambiguous or oversized candidates are rejected rather than guessed at.

53. A list with more than 2,000 options is treated as over the inspection limit and isn't read.

54. The recognizer stops at 250 recognized codes.

55. If a list goes over that limit, the inspection stops instead of reporting a partial list.

56. The recognizer accepts certain displayed code formats for district 05.

57. A displayed `MJ` or `MDJ` prefix, or an explicit Magisterial District Court prefix, marks a code as `EXPLICIT_MDJ`.

58. A plain numeric district code is marked `DISTRICT_CODE_UNVERIFIED`.

59. That distinction avoids claiming an MDJ connection the displayed text doesn't show.

60. If one option contains several code-like pieces, it is left unrecognized rather than the recognizer picking one at random.

61. Code identification rejects suffixes that look like parts of a docket number.

62. The app never uses option values or control names to work out codes.

63. A separate report validator checks the structure, counts, code formats and readiness conditions of the information the browser produces.

64. Older inspection reports can still be read, but a report made with an older method doesn't authorize a new run using the current method.

65. The current method identifier is `playwright-filing-control-inventory-v7`.

### Permits and pacing

66. Every source inspection needs its own single-use permit, prepared in advance and explicitly approved.

67. The diagnostic permit allows at most three requests to the source.

68. It allows zero PDFs and zero remote POSTs. A POST is the kind of request that submits a form.

69. The dates and event type stored in the permit are old placeholders. They are not dates that were entered, and they grant no permission to retrieve documents.

70. The source-access guard requires the app's managed API workflow to be stopped while the command-line inspection runs, and restarted afterward.

71. The three requests are spaced so each one starts at least 60 seconds after the previous response finished.

72. The latest request log shows that spacing. The shortest pause between one response finishing and the next request starting was 60.886 seconds.

### Three inspection runs

73. The first v7 inspection finished with three requests, no failures and no documents.

74. At the County and Final phases, it found one eligible office candidate with 49 options.

75. Its first parser recognized no displayed codes, so all 49 choices were left unrecognized.

76. That meant the recognizer couldn't identify these displayed options. It did not mean the dropdown has no codes, or that MDJ offices are absent.

77. The parser was then extended to accept more code formats. A focused test and a build check were run afterward.

78. The second inspection, under a new permit and the same three-request limit, also finished successfully.

79. It again found one office candidate with 49 options.

80. It again recognized no codes and counted all 49 options as unrecognized.

81. So accepting more code formats did not fix the problem of recognizing the site's displayed choices.

82. The next review considered whether the dropdown shows each option's `label` attribute rather than its text content.

83. The browser's `option.label` property is the right way to observe the label a standard dropdown actually displays.

84. Office-code recognition was changed to use that property, while still avoiding hidden option values.

85. A focused test sample was extended to include labels whose displayed text differs from the underlying text.

86. That sample also checked that hidden test markers, and codes that existed only in the underlying text, never appeared in the output.

87. The focused public-office test passed, the API build passed, and `git diff --check` reported no whitespace errors.

88. A third new permit was prepared and explicitly approved for the updated inspection.

89. The API workflow was stopped, the inspection ran once, and the workflow was restarted.

90. The third run also finished as `INSPECTED`, with three successful requests, no failures and no documents.

91. The request log shows all nine requests across the three office-identification runs were GET requests, the kind that only reads a page, and each returned HTTP 200 "OK".

92. The longest request in the third run took 664 milliseconds.

93. The third report again found one candidate with 49 choices and again recognized no codes.

94. So switching to the label the browser displays didn't solve identification either.

### Status

95. All three inspections completed their protocol, but none proved that a specific court office or MDJ choice had been identified.

96. The final report's `INSPECTED` status means the limited diagnostic finished. It does not mean source access was verified or that a search succeeded.

97. The source has not been approved for collection.

98. No office, case category, date or Search action was used in these inspections.

99. No PDFs, docket records or hearing records were sent or collected.

100. The API was restored after each inspection and started cleanly after the most recent one.

101. The public app preview showed its landing page, and the browser console showed no application errors.

102. According to the project notes, the offline checks included an API typecheck and build, 242 safety checks, and 44 Python tests run with network access blocked.

103. The later parser change and the displayed-label change each also passed the focused office-identification test sample and the build checks.

104. The open problem is now specific. To know what the 49 choices represent, and whether their visible text contains a recognized office code, the agent needs the dropdown's actual public field label and one of its displayed options.

105. A redacted example would answer this without inspecting hidden values, guessing an office, or running more format checks on speculation.

106. The question asking for that example was never completed. Its response came back with `cancelCause: agent_cancelled`, so there is no label, option or screenshot from you to analyze.

107. The task is therefore still in progress, not complete.

108. Several things remain unproven: finding the three paths (the filing-date search, the two hearing calendars, and PDF extraction), the search behavior beyond this diagnostic, and the search parameters actually sent to the server.

109. The next safe step is to get a redacted public field label and one displayed office option, then change the recognizer only if that evidence supports a specific format.

110. Until that evidence exists, along with the remaining approved source checks, the app must not claim the requested court search works end to end.

---

## Part B — The earlier exploratory work in this conversation (done by me, October 5–6, 2026)

111. This conversation was a separate exploratory session, not part of the Replit app. It ran under looser, case-by-case approvals you gave in the chat. It went further than the app's current diagnostic allows.

112. I clicked Search on the [UJS Portal](https://ujsportal.pacourts.us/CaseSearch). I downloaded docket-sheet PDFs: 10 in the first test and 44 in the second, 54 in total. I opened them through a cloud browser and hosted services after you authorized that.

113. I selected cases by filing date and the site's display order only. The first test used October 1, 2026. The second searched one day at a time for September 27–30, 2026.

114. I kept only docket numbers, bail fields and verdicts in `results200.csv`, and deleted each PDF right after reading it. While learning the layout, I printed one docket's text, which showed a posting party's name and the charges. I did not keep or repeat those details.

115. The second run stopped after 44 dockets when the portal returned HTTP 429, the "too many requests" signal. I had set a 5-second pause, which broke my own runbook's 10-second minimum, and I queued a second batch that sent one more request after the first refusal. Both were my errors.

116. Of the 44 dockets, 33 had no bail section and 3 had nonmonetary bail at $0.00. Seven had monetary bail: $1,000.00 once, $5,000.00 four times, $10,000.00 once and $20,000.00 once. One, MJ-05003-CR-0006860-2026, showed "Monetary" at $1.00. That $1.00 entry was never compared with its source PDF, and it may be a nominal-bail release rather than ordinary cash bail.

117. My parsers were tested with synthetic fixtures, clearly labeled and kept separate from real results. They were test inputs, not reported records. Under the stricter rule in paragraph 1, any future use should be confined to offline tests, and no synthetic content should appear anywhere records are shown.

## Part C — Where the two accounts meet, and what remains open

118. One observation from Part B bears directly on paragraph 104. On October 5, 2026, the portal's accessibility tree showed a dropdown labeled "MDJS Court Office". It was disabled until a county was chosen. I didn't record its options, so I can't say whether it is the same 49-choice control or what its options look like.

119. That label contains both a court word and an office word, so it would fit the candidate rule in paragraph 50. It still doesn't prove an MDJ context by itself (paragraph 34), and it is five days older than the Replit runs.

120. Part B also showed that, on that date, docket-sheet links in the results pointed to an MdjDocketSheet report, and docket numbers had the form MJ-05xxx-CR-…-2026. The Replit app should treat both observations as leads to verify, not as proven bindings. Its current permit allows zero PDFs, so they can't be used there yet.

121. The results in Part B came from actions outside the app's current diagnostic scope. They should not be read as proof that the app's search works, and the app should not bring them in as verified data without its own checks.

122. Status as of this revision: Part A's task remains in progress. Part B's run is paused at 44 of 200 dockets. Neither workstream has proven an end-to-end court search, a hearing-calendar path, or custody status.
