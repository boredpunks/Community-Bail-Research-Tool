"""Source-layout observation tests use public headers and non-case markup only."""
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from evidence import CalendarResults


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
