"""Protocol-only classification tests. No cases, source requests or raw logs."""
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from calendar_diagnostics import CalendarDiagnosticRecorder, resource_alias, location_class, failure_class, RESOURCE_TYPES


class RedactedDiagnosticTests(unittest.TestCase):
    def test_console_classification_requires_both_signature_and_session_provenance(self):
        optional = "https://invalid.test/pixel?token=REDACTION_SENTINEL"
        recorder = CalendarDiagnosticRecorder()
        recorder.register("optional", optional, "image", "READY")
        recorder.decide("optional", "OPTIONAL_ABORT")
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
        self.assertLessEqual(recorder.snapshot()[0]["count"], 10000)
        self.assertGreater(recorder.snapshot()[0]["count"], 9000)
        self.assertEqual(len(recorder.snapshot()), 1)

    def test_location_taxonomy_is_not_transmission_permission(self):
        for url, expected in [
            (None, "MISSING"), ("", "MISSING"), ("malformed", "INVALID"),
            ("https://[invalid", "INVALID"), ("x" * 2049, "INVALID"),
            ("about:blank", "NON_HTTP"), ("https://invalid.test/REDACTION_SENTINEL", "EXTERNAL_HTTP"),
            ("https://ujsportal.pacourts.us/unknown?token=REDACTION_SENTINEL", "SOURCE_OTHER"),
            ("https://ujsportal.pacourts.us/resource/js/sitemain.min.js?token=REDACTION_SENTINEL", "SOURCE_ASSET_PATH"),
        ]:
            self.assertEqual(location_class(url), expected)

    def test_all_failure_resource_types_and_unknown_type_are_retained(self):
        for resource in RESOURCE_TYPES | {"unrecognized-private-type"}:
            r = CalendarDiagnosticRecorder()
            url = "https://invalid.test/REDACTION_SENTINEL?token=private"
            r.register("request", url, resource, "READY")
            r.decide("request", "POLICY_ABORT")
            r.mark("SEARCH_ARMED")
            r.resource_failure(url, resource, set(), "RESULT", key="request", text="net::ERR_NAME_NOT_RESOLVED")
            row = r.snapshot()[0]
            self.assertEqual(row["resource"], resource if resource in RESOURCE_TYPES else "UNKNOWN")
            self.assertEqual(row["requestPhase"], "READY")
            self.assertEqual(row["requestStage"], "BEFORE_SEARCH")
            self.assertEqual(row["stage"], "SEARCH_ARMED")
            self.assertEqual(row["decision"], "POLICY_ABORT")
            self.assertEqual(row["failure"], "DNS")
            self.assertTrue(r.blocking_resource_failure)
            self.assertNotIn("REDACTION_SENTINEL", json.dumps(r.snapshot()))
            self.assertNotIn("private", json.dumps(r.snapshot()))

    def test_ambiguous_urls_are_not_reclassified_optional(self):
        r = CalendarDiagnosticRecorder()
        url = "https://invalid.test/fixture?token=REDACTION_SENTINEL"
        for key in ("first", "second"):
            r.register(key, url, "image", "READY")
            r.decide(key, "OPTIONAL_ABORT" if key == "second" else "POLICY_ABORT")
        self.assertFalse(r.console("error", "Failed to load resource: net::ERR_FAILED", url, {url}, "RESULT"))
        self.assertEqual(r.snapshot()[0]["match"], "AMBIGUOUS")
        self.assertEqual(r.snapshot()[0]["ordinal"], 0)
        self.assertEqual(r.snapshot()[0]["category"], "UNKNOWN_OR_UNSAFE")
        r.resource_failure(url, "image", {url}, "RESULT", key="second", text="net::ERR_FAILED")
        self.assertEqual(r.snapshot()[-1]["ordinal"], 2)
        self.assertEqual(r.snapshot()[-1]["category"], "BLOCKED_OPTIONAL_RESOURCE_ERROR")
        r.decide("first", "OPTIONAL_ABORT")
        self.assertTrue(r.console("error", "Failed to load resource: net::ERR_FAILED", url, {url}, "RESULT"))
        self.assertEqual(r.snapshot()[-1]["match"], "AMBIGUOUS")
        self.assertEqual(r.snapshot()[-1]["ordinal"], 0)

    def test_registry_overflow_is_distinct_from_no_match(self):
        r = CalendarDiagnosticRecorder()
        for i in range(130):
            r.register(i, f"https://invalid.test/{i}", "other", "READY")
        self.assertEqual(len(r.requests), 128)
        self.assertTrue(r.overflow)
        self.assertEqual(r.provenance("https://invalid.test/129")["match"], "OVERFLOW")
        self.assertEqual(r.provenance("https://invalid.test/1", 1)["match"], "UNIQUE")

    def test_transport_milestones_order_events_and_keep_request_start_stage(self):
        r = CalendarDiagnosticRecorder()
        url = "https://invalid.test/fixture"
        r.register(1, url, "other", "READY")
        r.mark("SEARCH_ARMED")
        r.console("error", "unclassified fixture", url, set(), "RESULT")
        before = r.snapshot()[-1]
        for name in ("POST_ATTEMPT", "RESPONSE_RECEIVED", "RESPONSE_BODY_READ", "POST_ACKNOWLEDGED",
                     "DOCUMENT_FULFILLED", "READ_ONLY", "INSPECTION", "PARSER_STARTED", "PARSER_REJECTED"):
            r.mark(name)
        r.console("error", "unclassified fixture", url, set(), "RESULT")
        after = r.snapshot()[-1]
        post = next(m["sequence"] for m in r.milestones if m["name"] == "POST_ATTEMPT")
        self.assertLess(before["lastSequence"], post)
        self.assertGreater(after["firstSequence"], post)
        self.assertEqual(after["requestStage"], "BEFORE_SEARCH")
        self.assertTrue(after["readOnly"])
        self.assertEqual(after["stage"], "PARSER_REJECTED")
        self.assertEqual(failure_class("net::ERR_ABORTED"), "NET_ABORTED")
        self.assertEqual(failure_class("net::ERR_FAILED"), "NET_FAILED")
        self.assertEqual(failure_class(status=403), "HTTP_DENIED")
        self.assertEqual(failure_class(status=429), "HTTP_RATE_LIMIT")
        self.assertEqual(failure_class(status=503), "HTTP_SERVER")
