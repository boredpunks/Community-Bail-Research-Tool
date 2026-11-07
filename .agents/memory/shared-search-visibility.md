---
name: Shared search visibility
description: Workspace-password access determines who can view earlier searches versus manage them.
---

Earlier bail searches and their results are visible to anyone who has passed the shared workspace password. The Search tab defaults to the currently running live search across sessions, while an explicit history selection remains honored. Only the session that created a search can resume it; any workspace user can clear eligible search history across sessions or save eligible results to shared Candidates.

**Why:** The workspace is shared across sessions; the user wants every user to see the current live search by default, while Clear remains workspace-wide and resume controls stay creator-owned.

**How to apply:** Keep search-history and result-status reads available across authenticated workspace sessions; default the Search tab to a running live search unless the user explicitly selects another history item; enforce creator-session checks for resume, allow any workspace user to clear eligible searches, and preserve shared Review and Candidates items.
