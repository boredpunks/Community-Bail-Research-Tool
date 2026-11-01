"""Local OCR of a rasterized genuine supplied page; no invented court records."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from unittest.mock import patch

import pymupdf

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "artifacts/api-server/src/ujs"))
from evidence import extract_bail
from pdf_ocr import bail_transcript, ordered_ocr_text


class ScannedPdfTextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with pymupdf.open(ROOT / "attached_assets/CpDocketSheet_1792451669525.pdf") as source:
            cls.native_pages = [page.get_text(sort=True) for page in source]
            with pymupdf.open() as scan:
                original = source[0]
                page = scan.new_page(width=original.rect.width, height=original.rect.height)
                page.insert_image(page.rect, pixmap=original.get_pixmap(dpi=220, alpha=False))
                cls.scan = scan.tobytes()

    def test_genuine_scanned_page_produces_visible_but_unvalidated_bail_text(self):
        self.assertIsNotNone(shutil.which("tesseract"), "The OCR runtime must be installed.")
        result = extract_bail(self.scan, "CP-02-CR-0005845-2026")
        self.assertEqual(result["extractionOutcome"], "UNSUPPORTED_LAYOUT", result.get("detail"))
        self.assertEqual(result["entries"], [], "OCR must never invent validated financial findings.")
        self.assertEqual(result["documentSha256"], hashlib.sha256(self.scan).hexdigest())
        self.assertEqual(result["bailSectionPages"], [1])
        self.assertIn("Bail Action", result["excerpt"])
        self.assertIn("$100.00", result["excerpt"])
        self.assertIn("OCR-assisted text is unvalidated", result["detail"])

    def test_ocr_timeout_is_visible_and_never_returns_guessed_evidence(self):
        with patch("pdf_ocr.shutil.which", return_value="tesseract"), patch(
            "pdf_ocr.subprocess.run", side_effect=subprocess.TimeoutExpired("tesseract", 20)
        ):
            result = extract_bail(self.scan, "CP-02-CR-0005845-2026")
        self.assertEqual(result["extractionOutcome"], "UNREADABLE")
        self.assertEqual(result["entries"], [])
        self.assertIsNone(result["excerpt"])
        self.assertIn("OCR stopped", result["detail"])

    def test_mixed_mdj_pdf_keeps_scanned_setting_separate_from_posted_security(self):
        with pymupdf.open(ROOT / "attached_assets/MdjDocketSheet_1792451676271.pdf") as source:
            with pymupdf.open() as mixed:
                mixed.insert_pdf(source, from_page=0, to_page=0)
                original = source[1]
                page = mixed.new_page(width=original.rect.width, height=original.rect.height)
                page.insert_image(page.rect, pixmap=original.get_pixmap(dpi=220, alpha=False))
                if source.page_count > 2:
                    mixed.insert_pdf(source, from_page=2)
                result = extract_bail(mixed.tobytes(), "MJ-05317-CR-0000264-2026")
        self.assertEqual(result["extractionOutcome"], "UNSUPPORTED_LAYOUT", result.get("detail"))
        self.assertEqual(result["entries"], [])
        self.assertEqual(result["bailSectionPages"], [2])
        self.assertIn("$1,000.00", result["excerpt"])
        self.assertNotIn("Bail Posted", result["excerpt"])

    def test_ocr_does_not_relax_document_identity(self):
        with patch("evidence.fill_scanned_pages", return_value=(self.native_pages, True, None)):
            result = extract_bail(self.scan, "CP-02-CR-0005846-2026")
        self.assertEqual(result["extractionOutcome"], "IDENTITY_MISMATCH")
        self.assertIsNone(result["excerpt"])

    def test_transcript_excludes_posted_security_and_preserves_source_page(self):
        result = bail_transcript(self.native_pages, {})
        self.assertIn("Bail Action", result["excerpt"])
        self.assertNotIn("Bail Posted", result["excerpt"])
        self.assertEqual(result["bailSectionPages"], [1])
        self.assertEqual(result["entries"], [])

    def test_ocr_words_follow_page_geometry_not_column_block_order(self):
        # Labels only: no synthetic case or financial observations.
        tsv = ("level\tleft\ttop\theight\ttext\n"
               "5\t20\t80\t12\tBail\n5\t50\t80\t12\tAction\n"
               "5\t20\t40\t12\tBAIL\n5\t60\t40\t12\tINFORMATION\n")
        self.assertEqual(ordered_ocr_text(tsv.encode()),
                         "BAIL INFORMATION\nBail Action")


if __name__ == "__main__":
    unittest.main()
