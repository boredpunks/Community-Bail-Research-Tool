"""Genuine user-supplied PDFs. No network or research-record writes."""
from pathlib import Path
import sys
import unittest
import pymupdf

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "artifacts/api-server/src/ujs"))
from evidence import extract_bail, iso_date, CalendarResults, validate_event_date
from bail_table import read_bail_tables, FinancialAssociationError


class SuppliedBail(unittest.TestCase):
    def read(self, name, docket):
        return extract_bail((ROOT / "attached_assets" / name).read_bytes(), docket)

    def test_common_pleas_recorded_amount_percentage_event_and_identity(self):
        body = (ROOT / "attached_assets/CpDocketSheet_1792451669525.pdf").read_bytes()
        result = extract_bail(body, "CP-02-CR-0005845-2026")
        self.assertEqual(result["extractionOutcome"], "EXTRACTED")
        entry = result["entries"][0]
        self.assertEqual((entry["amountCents"], entry["percentageCondition"],
                          entry["financialBasis"], entry["sourcePages"]),
                         (10000, "10.00%", "RECORDED_BAIL_AMOUNT", [1]))
        self.assertEqual(result["pdfEvents"][0]["eventDate"], "2026-10-20")
        self.assertEqual(result["pdfEvents"][0]["eventType"], "Formal Arraignment")
        self.assertNotEqual(entry["orderDate"], result["pdfEvents"][0]["eventDate"])
        self.assertEqual(entry["sourceEntryId"], extract_bail(body, "CP-02-CR-0005845-2026")["entries"][0]["sourceEntryId"])
        # The genuine originating docket is not the primary docket.
        self.assertEqual(extract_bail(body, "MJ-05003-CR-0002799-2026")["extractionOutcome"], "IDENTITY_MISMATCH")

    def test_mdj_posted_setting_stays_monetary(self):
        result = self.read("MdjDocketSheet_1792451676271.pdf", "MJ-05317-CR-0000264-2026")
        self.assertEqual(result["extractionOutcome"], "EXTRACTED")
        self.assertEqual(result["postedEntryState"], "SHOWN_POSTED")
        entry = result["entries"][0]
        self.assertEqual((entry["amountCents"], entry["action"], entry["sourcePages"]), (100000, "Set", [2]))
        self.assertEqual(len(result["entries"]), 1)
        self.assertTrue(any(event["eventType"] == "Preliminary Hearing" and event["eventDate"] == "2026-10-19" for event in result["pdfEvents"]))

    def test_no_bail_is_not_zero(self):
        result = self.read("MdjDocketSheet_(1)_1792451673387.pdf", "MJ-05310-NT-0000228-2026")
        self.assertEqual(result["extractionOutcome"], "MISSING_BAIL_SECTION")
        self.assertEqual(result["entries"], [])
        self.assertEqual(result["bailSectionPages"], [])

    def test_genuine_mdj_events_group_once_without_filing_date_substitution(self):
        docket = "MJ-05317-CR-0000264-2026"
        parsed = self.read("MdjDocketSheet_1792451676271.pdf", docket)
        grid = CalendarResults()
        grid.table_found = True
        grid._table_count = grid._header_rows = 1
        grid.headers = [""] * 19
        for index, label in {2: "Docket Number", 3: "Court Type", 6: "Filing Date",
                             9: "County", 10: "Court Office", 14: "Event Type", 16: "Event Date"}.items():
            grid.headers[index] = label
        for event in parsed["pdfEvents"] + parsed["pdfEvents"]:
            cells = [""] * 19
            date = "/".join((event["eventDate"][5:7], event["eventDate"][8:10], event["eventDate"][:4]))
            for index, value in {2: docket, 3: "Magisterial District Court",
                                 9: "Allegheny", 10: "MDJ-05-3-17", 14: event["eventType"], 16: date}.items():
                cells[index] = value
            grid.rows.append((cells, f"https://ujsportal.pacourts.us/Report/MdjDocketSheet?docketNumber={docket}"))
        # Parser-only structural grid from the genuine PDF's two known events;
        # not a live source capture or a launchable calendar window.
        criteria = {"courtOffice": "ANY", "eventType": "ANY", "courtRoom": "ANY",
                    "startDate": "2026-10-02", "endDate": "2026-10-19"}
        rows = grid.validated(criteria)
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(rows[0]["matchingEvents"]), 2)
        self.assertIsNone(rows[0]["filingDate"])
        self.assertEqual({event["eventDate"] for event in rows[0]["matchingEvents"]},
                         {"2026-10-02", "2026-10-19"})
        self.assertEqual(validate_event_date("10/02/2026", criteria), criteria["startDate"])
        self.assertEqual(validate_event_date("10/19/2026", criteria), criteria["endDate"])
        with self.assertRaises(ValueError):
            validate_event_date("10/20/2026", criteria)

    def test_invalid_pdf_and_image_only(self):
        self.assertEqual(extract_bail(b"<html>not a document</html>", "")["extractionOutcome"], "UNREADABLE")
        self.assertEqual(extract_bail(b"%PDF-broken", "")["extractionOutcome"], "UNREADABLE")
        with pymupdf.open(ROOT / "attached_assets/CpDocketSheet_1792451669525.pdf") as source:
            image = source[0].get_pixmap()
            with pymupdf.open() as image_only:
                page = image_only.new_page()
                page.insert_image(page.rect, pixmap=image)
                self.assertEqual(extract_bail(image_only.tobytes(), "CP-02-CR-0005845-2026")["extractionOutcome"], "UNREADABLE")


class StructuralBailGeometry(unittest.TestCase):
    """Financial-control fixtures only: no docket, defendant, or case record."""
    def table(self, rows, bad_amount=False):
        document = pymupdf.open()
        page = document.new_page(width=612, height=792)
        def line(y, values):
            for x, text in zip([40, 160, 245, 330, 475, 550], values):
                if text:
                    page.insert_text((x, y), text, fontsize=6)
        page.insert_text((250, 40), "BAIL INFORMATION", fontsize=8)
        line(65, ["Bail Action", "Date", "Bail Type", "Originating Court", "Percentage", "Amount"])
        for index, row in enumerate(rows):
            line(85 + index * 15, row)
        y = 100 + len(rows) * 15
        page.insert_text((40, y), "Bail Posted:", fontsize=7)
        line(y + 15, ["Surety Type", "Surety Name", "Posting Status", "Posted Dt", "Security Type", "Security Amt"])
        line(y + 30, ["Self", "", "Posted", "10/19/2026", "Cash", "$25.00"])
        page.insert_text((250, y + 50), "CHARGES", fontsize=8)
        page.insert_text((40, y + 65), "Unrelated amount $9,999.00", fontsize=7)
        body = document.tobytes()
        document.close()
        return body

    def test_percentage_security_unrelated_amounts_chronology_and_duplicates(self):
        rows = [
            ["Set", "10/19/2026", "Monetary", "Magisterial District Court", "10.00%", "$100.00"],
            ["Set", "10/19/2026", "Monetary", "Magisterial District Court", "10.00%", "$100.00"],
            ["Modified", "10/20/2026", "Monetary", "Magisterial District Court", "", "$200.00"],
            ["Revoked", "10/21/2026", "Monetary", "Magisterial District Court", "", "$200.00"],
            ["Denied", "10/22/2026", "Denied", "Magisterial District Court", "", ""],
        ]
        entries, excerpt, pages, posted = read_bail_tables(self.table(rows), iso_date)
        self.assertEqual([entry["amountCents"] for entry in entries], [10000, 20000, 20000, None])
        self.assertEqual([entry["action"] for entry in entries], ["Set", "Modified", "Revoked", "Denied"])
        self.assertEqual(posted, "SHOWN_POSTED")
        self.assertEqual(pages, [1])
        self.assertNotIn("9,999", excerpt)
        self.assertNotIn("$25", excerpt)

    def test_unassociated_money_is_ambiguous(self):
        with self.assertRaises(FinancialAssociationError):
            read_bail_tables(self.table([["Set", "10/19/2026", "Monetary", "Magisterial District Court", "", "$100.00 $200.00"]]), iso_date)


if __name__ == "__main__":
    unittest.main()
