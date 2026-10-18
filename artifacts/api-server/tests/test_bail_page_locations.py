"""Non-case section-location checks; no generated court records or PDFs."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from evidence import bail_sections


class BailPageLocations(unittest.TestCase):
    def test_original_page_numbers_survive_section_selection(self):
        sections = bail_sections([
            "Unrelated public instructions",
            "BAIL INFORMATION\nBail Action\nTable heading only\nCHARGES\nExcluded",
            "No bail heading here",
            "BAIL INFORMATION\nBail Action\nAnother heading only",
        ])
        self.assertEqual([page for page, _ in sections], [2, 4])
        self.assertNotIn("Excluded", sections[0][1])
        self.assertTrue(all(text.startswith("Bail Action") for _, text in sections))

    def test_missing_section_is_not_page_one(self):
        self.assertEqual(bail_sections(["Public instructions only"]), [])

    def test_unknown_section_header_stays_unsupported(self):
        with self.assertRaises(ValueError):
            bail_sections(["BAIL INFORMATION\nUnrecognized table"])
