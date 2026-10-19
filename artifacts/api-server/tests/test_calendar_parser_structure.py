"""Offline structural regressions. No fabricated case/docket records or traffic."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from evidence import CalendarResults, calendar_result_state, label_court_type


class CalendarParserStructureTests(unittest.TestCase):
    def setUp(self):
        self.criteria = {"courtOffice": "CP-05-02-Crim", "eventType": "Bail Hearing",
                         "startDate": "2026-10-18", "endDate": "2026-10-23"}
        labels = ["Column"] * 18
        for index, name in {2: "Docket Number", 3: "Court Type", 6: "Filing Date",
                            9: "County", 10: "Court Office", 14: "Event Type"}.items():
            labels[index] = name
        self.header = "<tr>" + "".join(f"<th>{label}</th>" for label in labels) + "</tr>"
        self.grid = '<table id="caseSearchResultGrid">' + self.header + '</table>'

    def parse(self, markup):
        parser = CalendarResults()
        parser.feed(markup)
        return parser

    def assert_unsupported(self, markup):
        parser = self.parse(markup)
        with self.assertRaisesRegex(ValueError, "^UNSUPPORTED_CALENDAR_LAYOUT$"):
            parser.validated(self.criteria)
        self.assertIsNone(parser.validated_column_headers)
        return parser

    def test_header_only_is_not_validated_empty_result(self):
        parser = self.parse(self.grid)
        self.assertEqual(parser.validated(self.criteria), [])
        self.assertEqual(calendar_result_state(True, [], False), "RESULTS_NOT_VALIDATED")
        self.assertTrue(parser.layout_summary()["complete"])

    def test_case_information_header_only_is_not_a_zero_match_result(self):
        labels = ["Column"] * 12
        for index, name in {0: "Docket Number", 1: "Court Type", 4: "Filing Date",
                            7: "County", 8: "Court Office"}.items():
            labels[index] = name
        table = '<table id="caseSearchResultGrid"><tr>' + "".join(
            f"<th>{label}</th>" for label in labels
        ) + "</tr></table>"
        criteria = {"courtOffice": "ANY", "courtRoom": "ANY", "eventType": "ANY",
                    "startDate": "2026-10-19", "endDate": "2026-10-19"}
        parser = self.parse(table)
        self.assertEqual(parser.validated(criteria), [])
        self.assertFalse(parser.explicit_empty_state)
        self.assertEqual(calendar_result_state(True, [], False), "RESULTS_NOT_VALIDATED")

    def test_case_information_layout_requires_supported_scope_and_link_identity(self):
        labels = ["Column"] * 12
        for index, name in {0: "Docket Number", 1: "Court Type", 4: "Filing Date",
                            7: "County", 8: "Court Office"}.items():
            labels[index] = name
        table = '<table id="caseSearchResultGrid"><tr>' + "".join(
            f"<th>{label}</th>" for label in labels
        ) + "</tr><tr>" + "<td></td>" * 12 + "</tr></table>"
        parser = self.parse(table)
        with self.assertRaisesRegex(ValueError, "^UNSUPPORTED_EVENT_DATE_LAYOUT$"):
            parser.validated({
                "courtOffice": "ANY", "courtRoom": "ANY", "eventType": "ANY",
                "startDate": "2026-10-19", "endDate": "2026-10-19",
            })

    def test_case_information_data_cannot_claim_a_scheduled_event_without_event_dates(self):
        labels = ["Column"] * 12
        for index, name in {0: "Docket Number", 1: "Court Type", 4: "Filing Date",
                            7: "County", 8: "Court Office"}.items():
            labels[index] = name
        table = '<table id="caseSearchResultGrid"><tr>' + "".join(
            f"<th>{label}</th>" for label in labels
        ) + "</tr><tr>" + "<td></td>" * 12 + "</tr></table>"
        parser = self.parse(table)
        with self.assertRaisesRegex(ValueError, "^UNSUPPORTED_EVENT_DATE_LAYOUT$"):
            parser.validated({"courtOffice": "ANY", "courtRoom": "ANY", "eventType": "ANY",
                              "startDate": "2026-10-19", "endDate": "2026-10-19"})

    def test_court_type_labels_are_explicit_and_unknown_labels_stay_unknown(self):
        self.assertEqual(label_court_type("Common Pleas"), "COMMON_PLEAS")
        self.assertEqual(label_court_type("Magisterial District Court"), "MDJ")
        self.assertIsNone(label_court_type("Unrecognized court type"))

    def test_duplicate_grids_cannot_be_merged(self):
        parser = self.assert_unsupported(self.grid + self.grid)
        self.assertEqual(parser.layout_summary()["resultTables"], 2)

    def test_unclosed_grid_is_rejected(self):
        parser = self.assert_unsupported(self.grid[:-8])
        self.assertFalse(parser.layout_summary()["complete"])

    def test_repeated_header_rows_are_unsupported(self):
        self.assert_unsupported(self.grid.replace(self.header, self.header * 2))

    def test_nested_result_content_is_unsupported(self):
        self.assert_unsupported(self.grid.replace("</table>",
            "<tr><td><table><tr><td></td></tr></table></td></tr></table>"))

    def test_mixed_header_and_data_cells_are_not_a_header(self):
        changed = self.header.replace("<th>Event Type</th>", "<td>Event Type</td>")
        self.assert_unsupported(self.grid.replace(self.header, changed))

    def test_presentation_row_is_diagnostic_not_empty_proof(self):
        markup = self.grid.replace("</table>",
            '<tr><td colspan="18">unverified fixture presentation</td></tr></table>')
        parser = self.parse(markup)
        summary = parser.layout_summary()
        self.assertEqual(summary["presentationRows"], 1)
        self.assertEqual(summary["nonHeaderRows"], 1)
        with self.assertRaisesRegex(ValueError, "^CALENDAR_DOCUMENT_LINK_MISSING$"):
            parser.validated(self.criteria)

    def test_invalid_row_stays_rejected(self):
        markup = self.grid.replace("</table>", "<tr>" + "<td></td>" * 18 + "</tr></table>")
        parser = self.parse(markup)
        with self.assertRaisesRegex(ValueError, "^CALENDAR_DOCUMENT_LINK_MISSING$"):
            parser.validated(self.criteria)

    def test_distinct_document_links_cannot_overwrite_each_other(self):
        row = ('<tr><td><a href="/Report/CpDocketSheet?docketNumber=invalid-one"></a>'
               '<a href="/Report/CpDocketSheet?docketNumber=invalid-two"></a></td></tr>')
        parser = self.parse(self.grid.replace("</table>", row + "</table>"))
        with self.assertRaisesRegex(ValueError, "^CALENDAR_DOCUMENT_LINK_MISSING$"):
            parser.validated(self.criteria)

    def test_summary_has_no_source_text_or_urls(self):
        row = ('<tr><td colspan="18">private-fixture-marker'
               '<a href="/Report/CpDocketSheet?docketNumber=invalid&amp;token=secret-marker">'
               'not-a-case</a></td></tr>')
        summary = self.parse(self.grid.replace("</table>", row + "</table>")).layout_summary()
        encoded = json.dumps(summary)
        for marker in ("private-fixture", "secret-marker", "docketNumber", "CpDocketSheet", "not-a-case"):
            self.assertNotIn(marker, encoded)
        self.assertEqual(summary["recognizedDocumentLinks"], 0)

    def test_unrelated_tables_do_not_change_result_headers(self):
        parser = self.parse('<table><tr><td>layout</td></tr></table>' + self.grid
                            + '<table><tr><th>unrelated</th></tr></table>')
        self.assertEqual(parser.validated(self.criteria), [])
        self.assertEqual(parser.layout_summary()["headerRows"], 1)

    def test_outer_layout_table_can_contain_the_result_grid(self):
        parser = self.parse('<table><tr><td>' + self.grid + '</td></tr></table>')
        self.assertEqual(parser.validated(self.criteria), [])

    def test_invalid_spans_fail_closed_without_crashing(self):
        for span in ('colspan', 'colspan="invalid"', 'colspan="0"', 'rowspan="2"'):
            with self.subTest(span=span):
                row = f'<tr><td {span}></td></tr>'
                self.assert_unsupported(self.grid.replace("</table>", row + "</table>"))

    def test_incremental_feed_preserves_table_state(self):
        parser = CalendarResults()
        for index in range(0, len(self.grid), 7):
            parser.feed(self.grid[index:index + 7])
        self.assertEqual(parser.validated(self.criteria), [])

    def test_returned_form_is_not_a_result_grid(self):
        parser = self.parse('<form><button id="btnSearch">Search</button></form>')
        with self.assertRaisesRegex(ValueError, "^RESULTS_NOT_VALIDATED$"):
            parser.validated(self.criteria)


if __name__ == "__main__":
    unittest.main()
