---
name: Shared Review retention
description: User-approved lifetime and removal semantics for shared Review and Candidates.
---

Shared Review is workspace-wide and spans searches. A reviewable docket remains until any workspace user deletes it from Review. Deleting it from Review hides that row but preserves source/search audit history and does not remove an already saved candidate.

Bulk search-history clearing must not bypass explicit deletion: retain any search with an active Review row and report how many searches were kept. Candidate records remain in shared Active/Archive until any workspace user removes them, following the existing audit-preserving removal behavior.

**Why:** The user confirmed that shared Review and candidate dockets remain until anyone deletes them.

**How to apply:** When changing Review visibility, automatic retention or expiry, search-history cleanup, or candidate actions, ensure no automatic cleanup removes active shared-list items.
