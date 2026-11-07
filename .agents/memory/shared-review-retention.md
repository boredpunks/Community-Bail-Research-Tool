---
name: Shared Review retention
description: User-approved lifetime and removal semantics for shared Review and Candidates.
---

Shared Review is workspace-wide and spans searches. A reviewable docket remains until any workspace user deletes it from Review. Deleting it from Review hides that row but preserves source/search audit history and does not remove an already saved candidate.

Bulk search-history clearing must not bypass explicit deletion: retain any search with an active Review row and report how many searches were kept. Candidate records remain in shared Active/Archive until any workspace user removes them, following the existing audit-preserving removal behavior.

Any workspace user may save an eligible search result to the shared Candidates list. Saving does not grant creator-only search controls such as resuming or clearing another user's search.

**Why:** The user confirmed shared Review and candidate retention until deletion, and clarified that candidate saving is available to every workspace user.

**How to apply:** When changing Review visibility, automatic retention or expiry, search-history cleanup, or candidate actions, ensure no automatic cleanup removes active shared-list items.
