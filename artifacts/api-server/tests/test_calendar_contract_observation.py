"""Source-layout observation tests use public headers and non-case markup only."""
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from evidence import CalendarResults, calendar_result_state


class ContractObservation(unittest.TestCase):
    def observe(self, row):
        parser = CalendarResults()
        parser.feed('<table id="caseSearchResultGrid"><tr><th>Column</th></tr>' + row + '</table>')
        return parser.contract_observation()

    def test_presentation_shape_and_status_do_not_become_empty_proof(self):
        observation = self.observe('<tr><td colspan="19">No records found.</td></tr>')
        self.assertEqual(observation["rows"][0]["shape"], "PRESENTATION_SHAPED")
        self.assertEqual(observation["rows"][0]["statusLabel"], "NO_RECORDS_FOUND")
        self.assertNotIn("empty", json.dumps(observation).lower())

    def test_link_representation_is_observed_not_accepted(self):
        row = '<tr>' + '<td></td>' * 18 + '<td><a href="https://ujsportal.pacourts.us/Report/CpDocketSheet?docketNumber=NOT_A_CASE">Private text</a></td></tr>'
        observation = self.observe(row)
        self.assertEqual(observation["rows"][0]["links"]["absoluteSourceDocket"], 1)
        self.assertFalse(observation["rows"][0]["docketShapedCell"])
        for text in ("Private text", "NOT_A_CASE", "docketNumber", "https:"):
            self.assertNotIn(text, json.dumps(observation))

    def test_unknown_text_and_links_are_redacted_and_rows_bounded(self):
        row = '<tr><td colspan="19">PRIVATE_SENTINEL<a href="https://invalid.test/?token=SECRET_SENTINEL">PRIVATE_SENTINEL</a></td></tr>'
        observation = self.observe(row * 10)
        self.assertEqual(len(observation["rows"]), 8)
        self.assertTrue(observation["rowsOmitted"])
        self.assertEqual(observation["rows"][0]["statusLabel"], "OTHER")
        self.assertNotIn("SENTINEL", json.dumps(observation))

    def test_exact_source_empty_status_validates_without_becoming_a_docket(self):
        headers = ["Column"] * 19
        for index, label in {
            2: "Docket Number", 3: "Court Type", 6: "Filing Date",
            9: "County", 10: "Court Office", 14: "Event Type",
        }.items():
            headers[index] = label
        table = '<table id="caseSearchResultGrid"><tr>' + "".join(
            f"<th>{header}</th>" for header in headers
        ) + '</tr><tr><td colspan="19">No results found</td></tr></table>'
        parser = CalendarResults()
        parser.feed(table)
        rows = parser.validated({
            "eventType": "Bail Hearing", "courtOffice": "CP-05-02-Crim",
            "startDate": "2026-10-18", "endDate": "2026-10-23",
        })
        self.assertEqual(rows, [])
        self.assertTrue(parser.explicit_empty_state)
        self.assertEqual(parser.validated_row_count, 1)
        self.assertEqual(calendar_result_state(True, rows, parser.explicit_empty_state),
                         "EMPTY_RESULTS_VALIDATED")

    def test_unknown_or_mixed_presentation_rows_are_not_silently_skipped(self):
        headers = ["Column"] * 19
        for index, label in {
            2: "Docket Number", 3: "Court Type", 6: "Filing Date",
            9: "County", 10: "Court Office", 14: "Event Type",
        }.items():
            headers[index] = label
        prefix = '<table id="caseSearchResultGrid"><tr>' + "".join(
            f"<th>{header}</th>" for header in headers
        ) + "</tr>"
        criteria = {
            "eventType": "Bail Hearing", "courtOffice": "CP-05-02-Crim",
            "startDate": "2026-10-18", "endDate": "2026-10-23",
        }
        for rows in (
            '<tr><td colspan="19">No case records currently available</td></tr>',
            '<tr><td colspan="19">No results found</td></tr>'
            '<tr><td colspan="19">Other notice</td></tr>',
            '<tr><td colspan="19"><a href="/unverified">No results found</a></td></tr>',
        ):
            parser = CalendarResults()
            parser.feed(prefix + rows + "</table>")
            with self.assertRaises(ValueError):
                parser.validated(criteria)
            self.assertFalse(parser.explicit_empty_state)
