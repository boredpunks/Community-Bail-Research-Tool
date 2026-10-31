---
name: Shared search visibility
description: Workspace-password access determines who can view earlier searches versus manage them.
---

Earlier bail searches and their results are visible to anyone who has passed the shared workspace password. Only the session that created a search can resume it or save its results.

**Why:** the user chose workspace-wide viewing while keeping actions restricted to the creating session.

**How to apply:** keep search-history and result-status reads available across authenticated workspace sessions; enforce creator-session checks for resume and save actions.
