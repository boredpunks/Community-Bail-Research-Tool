"""Offline action/structure probes, never saved case records or court traffic.

Identifiers come from the supplied genuine PDFs. Rows below exercise link and
markup mechanics only: blank cells are not asserted to be source case facts.
"""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from evidence import CalendarResults, exact_docket_link
from calendar_dom import complete_result_framing, projection_rejection_reason
from calendar_structure import STRUCTURE_REASONS

CP = "CP-02-CR-0005845-2026"
MDJ = "MJ-05317-CR-0000264-2026"
ORIGIN = "https://ujsportal.pacourts.us"
SHEET = "/Report/CpDocketSheet?docketNumber=" + CP
HEADERS = ["Column"] * 19
for index, label in {2: "Docket Number", 3: "Court Type", 6: "Filing Date",
                     9: "County", 10: "Court Office", 14: "Event Type"}.items():
    HEADERS[index] = label
HEADER = "<tr>" + "".join(f"<th>{label}</th>" for label in HEADERS) + "</tr>"


def parse(rows="", header=HEADER, closing="</table>"):
    parser = CalendarResults()
    parser.feed('<table id="caseSearchResultGrid">' + header + rows + closing)
    parser.close()
    return parser


def action_row(*hrefs):
    cells = ["", "", CP] + [""] * 16
    cells[-1] = "".join(f'<a href="{href}">Private action text</a>' for href in hrefs)
    return "<tr>" + "".join(f"<td>{cell}</td>" for cell in cells) + "</tr>"


class CandidateSelection(unittest.TestCase):
    def test_identical_relative_anchors(self):
        parser = parse(action_row(SHEET, SHEET))
        self.assertEqual(parser.rows[0][1], ORIGIN + SHEET)
        self.assertFalse(parser.layout_summary()["malformed"])

    def test_relative_absolute_aliases(self):
        parser = parse(action_row(SHEET, ORIGIN + SHEET))
        self.assertEqual(parser.rows[0][1], ORIGIN + SHEET)
        self.assertFalse(parser.layout_summary()["malformed"])

    def test_sheet_plus_summary_and_search(self):
        parser = parse(action_row(SHEET, "/Report/CpCourtSummary?docketNumber=" + CP,
                                  "/CaseSearch?docketNumber=" + CP))
        self.assertEqual(parser.rows[0][1], ORIGIN + SHEET)
        self.assertFalse(parser.layout_summary()["malformed"])

    def test_report_family_and_supported_path(self):
        for href, docket in [
            ("/Report/MdjDocketSheet?docketNumber=" + CP, CP),
            ("/Report/CpDocketSheet?docketNumber=" + MDJ, MDJ),
            ("/Report/CpCourtSummary?docketNumber=" + CP, CP),
            ("/CaseSearch?docketNumber=" + CP, CP),
        ]:
            with self.subTest(path=href.split("?")[0]):
                self.assertIsNone(exact_docket_link(href, docket))
        self.assertIsNotNone(exact_docket_link(
            "/Report/MdjDocketSheet?docketNumber=" + MDJ, MDJ))

    def test_distinct_opaque_actions_remain_ambiguous(self):
        parser = parse(action_row(SHEET + "&dnh=offline%2Bvalue",
                                  SHEET + "&dnh=offline%2Fvalue"))
        self.assertIsNone(parser.rows[0][1])
        self.assertTrue(parser.layout_summary()["malformed"])

    def test_preserves_opaque_serialization_and_identity(self):
        href = SHEET + "&dnh=offline%2B%2f%3Dvalue"
        self.assertEqual(exact_docket_link(href, CP), ORIGIN + href)
        self.assertIsNone(exact_docket_link(href, MDJ))
        for suffix in ("&unexpected=value", "&dnh=a&dnh=b", "#fragment"):
            self.assertIsNone(exact_docket_link(SHEET + suffix, CP))
        for href in ("//invalid.test" + SHEET, "https://invalid.test" + SHEET,
                     "/Report/../Report/CpDocketSheet?docketNumber=" + CP):
            self.assertIsNone(exact_docket_link(href, CP))

    def test_candidate_counts_distinguish_occurrences_representations_actions(self):
        parser = parse(action_row(SHEET, SHEET, ORIGIN + SHEET,
                                  "/Report/CpCourtSummary?docketNumber=" + CP))
        expected = {"rawAnchorOccurrences": 4, "uniqueRepresentations": 3,
                    "eligibleRepresentations": 2, "uniqueEligibleActions": 1}
        observation = parser.contract_observation()
        self.assertEqual(observation["version"], 2)
        self.assertEqual(observation["candidateCounts"], expected)
        self.assertEqual(observation["rows"][0]["candidateCounts"], expected)
        self.assertEqual(observation["recognizedDocumentLinks"], 1)
        encoded = json.dumps(observation)
        for private in (CP, "Private action text", "docketNumber", "https:", "offline"):
            self.assertNotIn(private, encoded)


class StructuralReasons(unittest.TestCase):
    def reasons(self, parser, validate=True):
        if validate:
            with self.assertRaises(ValueError):
                parser.validated({})
        return parser.contract_observation()["rejectionReasons"]

    def test_all_parser_malformed_branches_are_attributable(self):
        cases = {
            "NESTED_TABLE": "<tr><td><table></table></td></tr>",
            "ROW_OPENED_BEFORE_CLOSE": "<tr><tr><td></td></tr>",
            "CELL_OPENED_BEFORE_CLOSE": "<tr><td><td></td></tr>",
            "INVALID_CELL_SPAN": '<tr><td colspan="invalid"></td></tr>',
            "CELL_CLOSE_MISMATCH": "<tr><td></th></tr>",
            "ROW_CLOSED_WITH_OPEN_CELL": "<tr><td></tr>",
            "HEADER_CELL_SPAN": '<tr><th colspan="2"></th></tr>',
            "COMPETING_DOCUMENT_ACTIONS": action_row(SHEET + "&dnh=offline-a",
                                                    SHEET + "&dnh=offline-b"),
            "DATA_CELL_SPAN": '<tr><td colspan="2"></td><td></td></tr>',
            "MIXED_CELL_TYPES": "<tr><th></th><td></td></tr>",
            "TABLE_CLOSED_WITH_OPEN_CONTENT": "<tr><td>",
        }
        for reason, row in cases.items():
            with self.subTest(reason=reason):
                parser = parse(row)
                self.assertIn(reason, self.reasons(parser))
                self.assertTrue(parser.layout_summary()["malformed"])

    def test_multiple_reasons_accumulate_and_are_unique(self):
        parser = parse('<tr><th></th><td colspan="invalid"></tr>')
        reasons = self.reasons(parser)
        self.assertTrue({"INVALID_CELL_SPAN", "ROW_CLOSED_WITH_OPEN_CELL",
                         "MIXED_CELL_TYPES"} <= set(reasons))
        self.assertEqual(len(reasons), len(set(reasons)))

    def test_validation_structure_guards_are_attributable(self):
        missing = CalendarResults()
        self.assertIn("RESULT_TABLE_MISSING", self.reasons(missing))
        duplicate = parse()
        duplicate.feed('<table id="caseSearchResultGrid">' + HEADER + "</table>")
        self.assertIn("RESULT_TABLE_COUNT", self.reasons(duplicate))
        self.assertIn("HEADER_ROW_COUNT", self.reasons(parse(header=HEADER * 2)))
        self.assertIn("UNCLOSED_RESULT_CONTENT", self.reasons(parse(closing="")))
        self.assertIn("UNSUPPORTED_EVENT_HEADERS", self.reasons(parse(header="<tr><th></th></tr>")))
        self.assertIn("DOCUMENT_ACTION_MISSING", self.reasons(parse("<tr><td></td></tr>")))
        # Link mechanics only, not a source case row.
        short = parse(action_row(SHEET).replace("<td></td>", "", 5))
        self.assertIn("ROW_TOO_SHORT", self.reasons(short))

    def test_reason_and_count_bounds(self):
        parser = parse(('<tr><td colspan="invalid"></td></tr>') * 10)
        observation = parser.contract_observation()
        self.assertEqual(len(observation["rows"]), 8)
        self.assertTrue(observation["rowsOmitted"])
        self.assertEqual(observation["rejectionReasons"].count("INVALID_CELL_SPAN"), 1)
        crowded = parse(action_row(*([SHEET] * 10_001))).contract_observation()
        self.assertTrue(crowded["overflow"])
        self.assertEqual(crowded["candidateCounts"]["rawAnchorOccurrences"], 10_000)

    def test_no_arbitrary_reason_can_enter_projection(self):
        with self.assertRaisesRegex(ValueError, "UNKNOWN_CALENDAR_STRUCTURE_REASON"):
            CalendarResults().reject_structure("PRIVATE_SENTINEL")

    def test_projection_error_taxonomy_is_closed_and_source_free(self):
        for code, expected in [
            ("RESULTS_NOT_VALIDATED", "RESULT_TABLE_COUNT"),
            ("CALENDAR_RESPONSE_LIMIT", "DOM_PROJECTION_LIMIT"),
        ]:
            self.assertEqual(projection_rejection_reason(
                Exception("Page.evaluate: Error: " + code + "\nPRIVATE_SENTINEL")), expected)
        self.assertIsNone(projection_rejection_reason(Exception("PRIVATE_SENTINEL")))
        self.assertIsNone(projection_rejection_reason(Exception("")))

    def test_case_information_missing_event_date_is_attributable(self):
        labels = ["Docket Number", "Court Type", "Filing Date", "County", "Court Office"]
        header = "<tr>" + "".join(f"<th>{label}</th>" for label in labels) + "</tr>"
        parser = parse("<tr>" + "<td></td>" * 5 + "</tr>", header=header)
        with self.assertRaisesRegex(ValueError, "^UNSUPPORTED_EVENT_DATE_LAYOUT$"):
            parser.validated({"courtOffice": "ANY", "eventType": "ANY", "courtRoom": "ANY",
                              "startDate": "2026-10-20", "endDate": "2026-10-20"})
        self.assertIn("CASE_INFORMATION_EVENT_DATE_MISSING",
                      parser.contract_observation()["rejectionReasons"])

    def test_source_framing_branches_preserve_specific_reasons(self):
        cases = {
            "NESTED_TABLE": "<table></table>",
            "ROW_OPENED_BEFORE_CLOSE": "<tr><tr></tr>",
            "CELL_OUTSIDE_ROW": "<td></td>",
            "CELL_OPENED_BEFORE_CLOSE": "<tr><td><td></td></tr>",
            "CELL_CLOSE_MISMATCH": "<tr><td></th></tr>",
            "ROW_CLOSE_WITHOUT_OPEN_ROW": "</tr>",
            "ROW_CLOSED_WITH_OPEN_CELL": "<tr><td></tr>",
            "TABLE_CLOSED_WITH_OPEN_CONTENT": "<tr><td>",
        }
        for reason, content in cases.items():
            with self.subTest(reason=reason):
                reasons = []
                self.assertFalse(complete_result_framing(
                    ('<table id="caseSearchResultGrid">' + content + "</table>").encode(),
                    "text/html; charset=utf-8", reasons))
                self.assertIn(reason, reasons)
                self.assertTrue(set(reasons) <= set(STRUCTURE_REASONS))
        for body, content_type, reason in [
            (b'<table id="caseSearchResultGrid"><tr>', "text/html", "UNCLOSED_RESULT_CONTENT"),
            (b"\xff", "text/html; charset=utf-8", "SOURCE_DECODING_FAILED"),
            (b"", "text/html; charset=unknown", "SOURCE_ENCODING_UNSUPPORTED"),
            (b"<" + b"x" * 1_100_000, "text/html", "SOURCE_TOKEN_LIMIT"),
        ]:
            with self.subTest(reason=reason):
                reasons = []
                self.assertFalse(complete_result_framing(body, content_type, reasons))
                self.assertIn(reason, reasons)


if __name__ == "__main__":
    unittest.main()
