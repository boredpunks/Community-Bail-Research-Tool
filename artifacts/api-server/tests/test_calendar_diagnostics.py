"""Protocol-only classification tests. No cases, source requests or raw logs."""
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from calendar_diagnostics import CalendarDiagnosticRecorder, resource_alias


class RedactedDiagnosticTests(unittest.TestCase):
    def test_console_classification_requires_both_signature_and_session_provenance(self):
        optional = "https://invalid.test/pixel?token=REDACTION_SENTINEL"
        recorder = CalendarDiagnosticRecorder()
        signature = "Failed to load resource: net::ERR_FAILED"
        self.assertTrue(recorder.console("error", signature, optional, {optional}, "RESULT"))
        self.assertFalse(recorder.console("error", signature, None, {optional}, "RESULT"))
        self.assertFalse(recorder.console("error", "REDACTION_SENTINEL", optional, {optional}, "RESULT"))
        self.assertFalse(recorder.console("error", signature,
            "https://ujsportal.pacourts.us/resource/js/sitemain.min.js?v=fixture_version_0001", set(), "RESULT"))
        self.assertFalse(recorder.console("error", "x" * 2049 + "REDACTION_SENTINEL",
            "https://ujsportal.pacourts.us/CaseSearch", set(), "RESULT"))
        groups = recorder.snapshot()
        self.assertEqual({r["category"] for r in groups}, {"BLOCKED_OPTIONAL_RESOURCE_ERROR",
            "REQUIRED_RESOURCE_FAILURE", "OTHER_CONSOLE_ERROR", "UNKNOWN_OR_UNSAFE"})
        safe = json.dumps(groups)
        for text in ("REDACTION_SENTINEL", "invalid.test", "fixture_version", "net::", "token", "https://"):
            self.assertNotIn(text, safe)
        self.assertEqual(resource_alias("https://ujsportal.pacourts.us/CaseSearch?token=private", set()), "OTHER")

    def test_count_and_group_bounds_report_overflow_without_retaining_messages(self):
        recorder = CalendarDiagnosticRecorder()
        for _ in range(10002):
            recorder.exception("RESULT")
        self.assertTrue(recorder.overflow)
        self.assertEqual(recorder.snapshot()[0]["count"], 10000)
        self.assertEqual(len(recorder.snapshot()), 1)
