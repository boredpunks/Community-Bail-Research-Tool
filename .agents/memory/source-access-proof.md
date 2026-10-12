---
name: Source proof is client-specific
description: Calendar and PDF access must be proven using the same request methods used by the live adapter.
---

Treat a source-access proof as specific to the HTTP/browser methods actually tested. Calendar access alone does not establish docket access, and a successful standard HTTP PDF download does not prove Playwright's request client will work.

**Why:** On October 6, 2026, ordinary browser calendar submission and a standard HTTP docket download succeeded during assessment. The integrated browser-calendar job later received HTTP 403 for its Playwright-client PDF request. The cause of the denial was not established.

**How to apply:** Demonstrate both retrieval stages using the actual integrated methods before calling live search complete. After denial, preserve the source-wide pause and request history. Disclose and obtain approval for a changed method; do not infer authorization or a network cause from a previously successful client.

A bounded download assessment is not approval to resume broader collection, even if the assessment succeeds.

**Why:** The user approved one standard-HTTP check after an integrated-client denial. That check succeeded while the source-wide pause remained intact; its approval covered one request only.

**How to apply:** Count the approved check against the original job budget and retain its evidence. Obtain separate approval before enabling a changed collection method or making additional source requests. Do not reuse a single-request approval.

An empty development request ledger does not erase the earlier unresolved denial or supply fresh access proof.

**Why:** During safeguard preparation, the development source row had null verification/approval fields and no recorded requests, despite the previously observed integrated-client denial.

**How to apply:** Keep collection disabled when proof is missing. Do not seed successful proof or reuse the consumed one-request approval to make the search interface usable; obtain a newly scoped exact-client assessment.

The exact browser asset policy and calendar-form validation are part of method-specific access proof, not incidental implementation details.

**Why:** A prior browser workflow had working calendar results while the next integrated client returned only the search form; the failing run retained no blocked-asset paths or DOM snapshot, so the cause could not be established. A later offline audit found stricter handling of versioned bundle URLs but cannot prove that this caused the live result.

**How to apply:** Require fresh approval and verification whenever the browser asset allowlist, form-submission checks, or HTTP client changes. Treat a successful HTTP status, a visible form, or a plausible code-level cause as insufficient proof of a submitted, validated calendar query.

Console-error counts alone do not prove a required-script or form failure.

**Why:** A bounded run loaded both known bundles successfully but stopped before submission on two console errors. Offline browser fixtures then demonstrated that intentionally blocked optional images also emit console errors; the live cause remained unresolved because only counts were retained.

**How to apply:** Classify optional-resource noise only with exact provenance and a demonstrated browser signature. Keep unclassified errors fail-closed, never retrospectively reclassify a historical run from counts alone, and never record raw console text or token-bearing URLs.

Use fixed public control labels and reason categories for form validation failures, not a single generic mismatch code.

**Why:** Once bundle loading and optional aborts were distinguished, a live run stopped on a control mismatch; no retained evidence identified which field was missing, disabled, unassociated or changed. That prevented offline diagnosis despite a correctly stopped request stream.

**How to apply:** Keep private values and hidden tokens out of logs. Retain only bounded public labels and boolean/state reasons; do not reinterpret missing historical diagnostics as proof that a specific control caused the failure.

Distinguish public UI widgets from their native submitted model controls; do not assume every dropdown has its own submission name.

**Why:** A live preflight identified unnamed public widgets. A later hidden-model/layout assumption also failed without identifying their actual native submission model. The source backing-field layout was not retained.

**How to apply:** Require unambiguous source-DOM association and matching actual native submission data before accepting a backing control. Never infer a server field name, waive readback, or treat a hypothetical public form fixture as source proof. Collect all bounded public-control failures in one pass. When a guessed backing layout fails, stop repeating PDF pilots and obtain separately authorized source-backed public form/submission evidence first.
