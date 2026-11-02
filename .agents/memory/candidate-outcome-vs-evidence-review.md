---
name: Candidate outcome vs. evidence review
description: Keep user-reported bail-out outcomes, candidate archiving and source-evidence review as separate facts.
---

Marking a candidate as successfully bailed out is a workspace-reported outcome, not a source-verified bail observation. Keep it separate from `reviewStatus` and order interpretation. Archiving removes a candidate from the active candidate list but preserves the source observation and any review history. Removing a candidate hides it from candidate lists without deleting that underlying record.

**Why:** The candidate action records what a workspace user reports about a later outcome; changing evidence-review fields would falsely imply the source document was checked or the bail setting itself was confirmed.

**How to apply:** Store outcome, archive and candidate-removal state separately; do not use them to change bail evidence or review decisions. Make removal's effect explicit to users and retain the audit record.
