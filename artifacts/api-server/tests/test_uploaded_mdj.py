"""Additional real local sample; no personal PDF or case identity is committed."""
import os
from pathlib import Path
import re
import sys
import unittest
import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/ujs"))
from evidence import extract_bail
from document_regression import EXPECTED

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = os.environ.get("LOCAL_DOCKET_PDF")
if not FIXTURE:
    found = list((ROOT / "attached_assets").glob("0_MdjDocketSheet_*.pdf"))
    FIXTURE = str(found[0]) if len(found) == 1 else None


@unittest.skipUnless(FIXTURE and Path(FIXTURE).is_file(), "Additional real PDF must be supplied locally; never commit personal records")
class UploadedMdjTests(unittest.TestCase):
    def test_real_header_mapped_entries_and_posting(self):
        body = Path(FIXTURE).read_bytes()
        with pymupdf.open(stream=body, filetype="pdf") as doc:
            docket = re.search(r"Docket\s+Number:\s*(MJ-\d{5}-CR-\d{7}-\d{4})",
                               doc[0].get_text(sort=True)).group(1)
        result = extract_bail(body, docket)
        self.assertEqual(result["extractionOutcome"], "EXTRACTED")
        self.assertEqual(result["documentPageCount"], 2)
        self.assertEqual(result["bailSectionPages"], [2])
        self.assertEqual(result["postedEntryState"], "NOT_SHOWN")
        self.assertEqual(len(result["entries"]), 1)
        entry = result["entries"][0]
        self.assertEqual((entry["action"], entry["bailCategory"], entry["amountCents"]),
                         ("Set", "MONETARY", 100000))
        self.assertEqual(entry["financialBasis"], "TOTAL_BAIL")
        self.assertEqual(entry["orderDate"], "2026-10-02")
        self.assertEqual(entry["originatingCourt"], "Magisterial District Court")
        self.assertIsNone(entry["percentageCondition"])
        self.assertEqual(entry["sourcePages"], [2])
        self.assertIn("Originating Court", result["excerpt"])
        self.assertIn("Magisterial District Court", result["excerpt"])
        # A real, different operator-supplied identity must be rejected.
        self.assertEqual(extract_bail(body, EXPECTED[0][0])["extractionOutcome"], "IDENTITY_MISMATCH")
