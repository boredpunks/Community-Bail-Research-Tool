---
name: PDF transcript validation
description: Why OCR transcripts remain unvalidated and why spatial reading order matters.
---

OCR text may be displayed for review, but it must not establish bail amounts, classifications, eligibility, or saved financial findings by itself. Document identity checks remain strict.

**Why:** OCR can silently change a date or dollar value into a different, valid-looking token. Recognizing its format is not proof of its accuracy.

**How to apply:** Keep OCR-derived transcripts clearly marked as unvalidated and require independent source comparison before promoting their content into verified financial observations.

Use word geometry to reconstruct OCR reading order rather than trusting the engine's plain-text block sequence.

**Why:** The engine placed bail-table column labels before the bail-section heading in a genuine scanned source page, which caused a section-bounded transcript to omit readable text.

**How to apply:** Preserve page locations and spatial ordering for OCR transcripts; ordering does not itself validate any financial association.
