"""Public route and header-only checks; no invented cases or PDF evidence."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/ujs"))
from source_protocol import allowed
from mdj_bail import extract_mdj_bail
from evidence import iso_date
from document_regression import EXPECTED


class MdjProtocolTests(unittest.TestCase):
    def test_only_exact_document_paths_methods_and_queries(self):
        for docket, *_ in EXPECTED[:3]:
            url = "https://ujsportal.pacourts.us/Report/MdjDocketSheet?docketNumber=" + docket
            self.assertTrue(allowed(url, "GET"))
            self.assertTrue(allowed(url + "&dnh=public-fixture", "GET"))
            self.assertFalse(allowed(url, "POST"))
            self.assertFalse(allowed(url + "&docketNumber=" + docket, "GET"))
            self.assertFalse(allowed(url + "&dnh=one&dnh=two", "GET"))
            self.assertFalse(allowed(url + "&other=value", "GET"))
            self.assertFalse(allowed(url.replace("MdjDocketSheet", "CpDocketSheet"), "GET"))

    def test_mdj_identity_and_missing_bail_remain_explicit(self):
        docket = EXPECTED[0][0]
        base = {"entries": [], "postedEntryState": "UNKNOWN", "excerpt": None}
        header = f"Magisterial District Judge\nDocket Number: {docket}\nCounty: Allegheny\n"
        self.assertEqual(extract_mdj_bail([header], docket, base.copy(), iso_date)["extractionOutcome"],
                         "MISSING_BAIL_SECTION")
        self.assertEqual(extract_mdj_bail(["Unrecognized court header"], docket, base.copy(), iso_date)["extractionOutcome"],
                         "IDENTITY_MISMATCH")
        # An empty action-table header is not evidence of bail, an amount, or
        # posting status. Real monetary rows are tested only from source PDFs.
        parsed = extract_mdj_bail([header + "\nBAIL\nBail Action Type Date Bail Type Percentage Amount\n"],
                                 docket, base.copy(), iso_date)
        self.assertEqual(parsed["extractionOutcome"], "UNSUPPORTED_LAYOUT")
        self.assertEqual(parsed["entries"], [])
        self.assertEqual(parsed["postedEntryState"], "UNKNOWN")
