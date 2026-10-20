# Calendar-linked document access

## Retained evidence

The current development denial originated at 2026-10-18 23:46:48 UTC:
GET `/Report/MdjDocketSheet` returned **HTTP 401** during the
`urllib-explicit-document-regression-v1` assessment. This was a no-cookie
document request using a constructed regression URL, not an embedded PDF
viewer or a captured current calendar action. The failed request and its
ACCESS_DENIED classification remain intact.

Historical assessment notes also record an HTTP 403 from Playwright's request
client. That is separate historical evidence, not the origin of the currently
retained development stop. Neither event proves that the same document cannot
be opened through a source-provided action in its calendar browser session.

`source_protocol.classify_response` classifies actual 401/403 responses before
examining the body. `accountSourceResponse` atomically records that result,
pauses jobs and invalidates access/collection proof. Later successful calendar
requests preserve the document stop. The validation-only clear command cannot
clear ACCESS_DENIED.

## Supported retrieval path

The normal worker now opens the **captured calendar action** in a child tab of
the **same Chromium context** that validated the calendar results. It does not
reconstruct the link, export cookies, or use urllib/Playwright's request client.
The existing parent limiter must grant that exact document request first.

The original browser navigation carries the session and normal browser
referrer policy. Only its first exact GET is permitted. A response-header gate
rejects redirects and HTTP failures before following or executing them.
For a successful response, only the local Content-Disposition is changed to
attachment so the original body can be downloaded without depending on a PDF
viewer. Chromium download completion, the 4 MB bound, PDF signature and docket
identity are checked separately. Temporary bytes are discarded. Browser
exceptions, cookies, opaque action URLs and response headers are never logged.

A browser handoff/download abort is not itself an access denial. A real 401/403
still is, and stops retrieval without retry. A checkpoint from a closed browser
is not a reusable authenticated calendar session: it pauses with instructions
to start the same calendar search again or use local PDF verification.

The integrated method identifier changed, invalidating old method-specific
proof. This does **not** clear or relabel the retained denial or enable document
collection. Clearing the stop requires a reviewed, explicitly authorized
assessment establishing access with this exact method and verified PDF
identity; ordinary collection additionally requires current-method collection
approval. No matching approved browser-document assessment is currently saved.

## Verification and remaining live limitation

Offline Chromium tests use loopback HTTP and the genuine supplied Common Pleas
PDF. They prove that the captured action opens with the calendar session,
calendar referrer and document-navigation headers; the PDF is extracted as the
recorded $100 amount. Separate tests preserve a real 401 and prevent following
a 302. No synthetic case data or real court requests are used in those tests.

Command:

    python -m unittest discover -s artifacts/api-server/tests -p test_calendar_document.py -v

All three checks passed. Live verification is not claimed: the latest current
calendar search reached POST `/CaseSearch` but stopped at UNSUPPORTED_LAYOUT
before establishing result rows or document actions. No validated saved
calendar checkpoint is currently available for a same-document live comparison.
