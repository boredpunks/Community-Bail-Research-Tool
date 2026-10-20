"""Only the four real operator-supplied dockets. Never generate case PDFs."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/ujs"))
from document_regression import EXPECTED, verify
from evidence import extract_bail

DIRECTORY = Path(__file__).resolve().parents[3] / "generated-artifacts/document-regression"


class RealDocumentRegressionTests(unittest.TestCase):
    def test_all_expected_source_documents_are_required_for_verification(self):
        # The verification gate must fail explicitly, not pass an empty list,
        # when source access denial leaves these real PDFs unavailable.
        if not all((DIRECTORY / f"{row[0]}.pdf").is_file() for row in EXPECTED):
            self.assertFalse(verify(DIRECTORY)["verified"])


def source_test(docket, category, amount, posted):
    def run(self):
        file = DIRECTORY / f"{docket}.pdf"
        if not file.is_file():
            self.skipTest("Real source PDF not retrieved; integrated client stopped on HTTP 401.")
        parsed = extract_bail(file.read_bytes(), docket)
        self.assertEqual(parsed["extractionOutcome"], "EXTRACTED", parsed.get("detail"))
        self.assertTrue(any(row["bailCategory"] == category and row["amountCents"] == amount
                            for row in parsed["entries"]), parsed["entries"])
        if posted is not None:
            self.assertEqual(parsed["postedEntryState"], posted)
    return run


for index, row in enumerate(EXPECTED):
    setattr(RealDocumentRegressionTests, f"test_real_source_document_{index + 1}", source_test(*row))
