"""Network-blocked public-form fixtures. No court traffic or docket/case data."""
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode, urlsplit
from playwright.async_api import Route

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
import worker
from form_inspection import local_post_metadata, expected

CRITERIA = {"courtOffice": "CP-05-02-Crim", "eventType": "Bail Hearing",
            "startDate": "2026-10-13", "endDate": "2026-10-17"}


def public_fixture():
    # Explicitly hypothetical widget/native text layout, not source proof.
    groups = []
    for label, selector, container, key, value in expected(CRITERIA):
        if container:
            groups.append(f'<div id="{container}"><select><option value="{value}">{label}</option></select>'
                          f'<input type="text" name="{key}" value="{value}" style="display:none">'
                          '<input type="hidden" name="__RequestVerificationToken" value="REDACTION_SENTINEL"></div>')
        else:
            groups.append(f'<input type="date" name="{key}" value="{value}">')
    return ('<!-- hypothetical public form; no case data -->'
            '<link rel="stylesheet" href="/resource/css/sitemain.min.css">'
            '<script src="/resource/js/sitemain.min.js"></script>'
            '<form method="post" action="https://ujsportal.pacourts.us/CaseSearch">'
            + "".join(groups) + '<button id="btnSearch">Search</button></form>')


class InspectionWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def run_fixture(self, script="/* public fixture */"):
        messages, fetches = [], []
        html = public_fixture()
        original_fulfill = Route.fulfill

        class Response:
            status = 200
            def __init__(self, body, content_type):
                self.content = body.encode()
                self.headers = {"content-type": content_type}
            async def body(self):
                return self.content
            async def dispose(self):
                pass

        async def fake_fetch(route, **_kwargs):
            path = urlsplit(route.request.url).path
            fetches.append((route.request.method, path))
            if path == "/CaseSearch":
                return Response(html, "text/html")
            if path == "/resource/css/sitemain.min.css":
                return Response("/* public fixture */", "text/css")
            if path == "/resource/js/sitemain.min.js":
                return Response(script, "application/javascript")
            raise AssertionError("Unexpected fixture fetch; real network is disabled")

        async def fake_fulfill(route, *, response=None, **kwargs):
            if response is not None:
                return await original_fulfill(route, status=response.status,
                                              headers=response.headers, body=response.content)
            return await original_fulfill(route, **kwargs)

        config = {"criteria": CRITERIA, "inspectionOnly": True, "calendarComplete": False,
                  "pendingItems": [], "remainingRecords": 1}
        lines = [json.dumps(config)]
        for index in range(3):
            lines.extend([json.dumps({"allow": True, "requestId": f"fixture-{index}"}),
                          json.dumps({"continue": True})])
        with patch.object(Route, "fetch", fake_fetch), patch.object(Route, "fulfill", fake_fulfill), \
                patch.object(worker.sys, "stdin", io.StringIO("\n".join(lines) + "\n")), \
                patch.object(worker, "emit", lambda kind, **values: messages.append({"kind": kind, **values})), \
                patch.object(worker, "response_pause", return_value=0), \
                patch.object(worker, "download", side_effect=AssertionError("PDFs prohibited")):
            await worker.main()
        return messages, fetches

    async def test_actual_worker_intercepts_post_and_retains_only_metadata(self):
        messages, fetches = await self.run_fixture()
        self.assertEqual(len(fetches), 3)
        self.assertTrue(all(method == "GET" for method, _ in fetches))
        self.assertEqual({path for _, path in fetches},
                         {"/CaseSearch", "/resource/css/sitemain.min.css", "/resource/js/sitemain.min.js"})
        self.assertEqual(sum(message["kind"] == "request" for message in messages), 3)
        snapshots = [message for message in messages if message["kind"] == "inspection_metadata"]
        self.assertEqual([message["phase"] for message in snapshots], ["BEFORE", "LOCAL_POST"])
        self.assertEqual([row["nativePostedMatches"] for row in snapshots[-1]["controls"]], [1] * 6)
        self.assertEqual(snapshots[0]["controls"][0]["types"]["text"], 1)
        self.assertEqual(snapshots[0]["controls"][0]["types"]["hidden"], 0)
        self.assertTrue(any(message["kind"] == "inspection_finished" for message in messages))
        self.assertFalse(any(message["kind"] in {"calendar", "docket", "finished", "barrier"} for message in messages))
        retained = json.dumps(snapshots)
        for forbidden in ["REDACTION_SENTINEL", "__RequestVerificationToken", "CP-05-02-Crim", "2026-10-13"]:
            self.assertNotIn(forbidden, retained)

    async def test_dependent_control_requests_are_aborted_not_fetched(self):
        messages, fetches = await self.run_fixture(
            "document.addEventListener('change', () => fetch('/CaseSearch'));")
        self.assertEqual(len(fetches), 3)
        self.assertFalse(any(message["kind"] == "inspection_finished" for message in messages))
        self.assertTrue(any(message["kind"] == "barrier" for message in messages))

    def test_body_limits_and_known_key_observation_are_not_binding_proof(self):
        before = {"controls": [{"control": item[0], "types": {}} for item in expected(CRITERIA)]}
        bindings = [[] for _ in range(6)]
        body = urlencode({item[3]: item[4] for item in expected(CRITERIA)})
        result = local_post_metadata(before, bindings, CRITERIA,
                                     body + "&__RequestVerificationToken=REDACTION_SENTINEL",
                                     "application/x-www-form-urlencoded")
        self.assertEqual([row["nativePostedMatches"] for row in result["controls"]], [0] * 6)
        self.assertEqual([row["knownKeyPostedMatches"] for row in result["controls"]], [1] * 6)
        self.assertNotIn("REDACTION_SENTINEL", json.dumps(result))
        for bad_body, content_type in [("x" * 131073, "application/x-www-form-urlencoded"),
                                      (body, "application/json"),
                                      ("&".join(["a=x"] * 129), "application/x-www-form-urlencoded")]:
            with self.assertRaisesRegex(RuntimeError, "^INSPECTION_BODY_UNSUPPORTED$"):
                local_post_metadata(before, bindings, CRITERIA, bad_body, content_type)
