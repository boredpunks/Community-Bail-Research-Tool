"""Offline regression checks for cached PDF identity, provenance and privacy."""

import contextlib
import hashlib
import importlib.util
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "prove-end-to-end.py"
ASSET = ROOT / "attached_assets" / "CpDocketSheet_1793205784766.pdf"
spec = importlib.util.spec_from_file_location("prove_end_to_end", SCRIPT)
proof = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(proof)


class CachedPdfProvenanceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        proof.CACHE_DIR = Path(self.temp.name)
        self.request_calls = []
        self.original_get = proof.requests.get
        proof.requests.get = lambda *args, **kwargs: self.request_calls.append(args) or self.fail(
            "cached evidence must not make a court request"
        )
        self.row = next(row for row in proof.PROOF_ROWS
                        if row["docket_number"] == "CP-02-CR-0003870-2026")
        self.cache_file = proof.CACHE_DIR / (
            hashlib.sha256(self.row["sourceUrl"].encode("utf-8")).hexdigest() + ".pdf"
        )
        self.cache_file.write_bytes(ASSET.read_bytes())

    def tearDown(self):
        proof.requests.get = self.original_get
        self.temp.cleanup()

    def invoke(self, row):
        old_stdin = proof.sys.stdin
        output = io.StringIO()
        try:
            proof.sys.stdin = io.StringIO(json.dumps(row))
            with contextlib.redirect_stdout(output):
                proof.cached_json()
        finally:
            proof.sys.stdin = old_stdin
        return output.getvalue()

    def test_valid_cached_pdf_retains_hash_pages_quote_and_identity_without_network(self):
        raw = self.cache_file.read_bytes()
        output = self.invoke({"docket_number": self.row["docket_number"], "sourceUrl": self.row["sourceUrl"]})
        result = json.loads(output)
        self.assertEqual(result["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result["page_count"], proof.validate_pdf_bytes(raw, self.row["docket_number"]))
        self.assertEqual(result["http_requests"], 0)
        self.assertTrue(all(entry["page"] > 0 and entry["quote"].strip() for entry in result["entries"]))
        self.assertTrue(all(entry["page"] <= result["page_count"] for entry in result["entries"]))
        self.assertEqual(self.request_calls, [])
        self.assertNotIn(self.row["sourceUrl"], output)
        self.assertNotIn(self.row["dnh"], output)
        self.assertNotIn(str(self.cache_file), output)

    def test_cached_pdf_for_another_docket_is_rejected_without_network(self):
        other = next(row for row in proof.PROOF_ROWS
                     if row["docket_number"] != self.row["docket_number"])
        other_cache = proof.CACHE_DIR / (
            hashlib.sha256(other["sourceUrl"].encode("utf-8")).hexdigest() + ".pdf"
        )
        shutil.copyfile(self.cache_file, other_cache)
        old_stdin = proof.sys.stdin
        try:
            proof.sys.stdin = io.StringIO(json.dumps({
                "docket_number": other["docket_number"],
                "sourceUrl": other["sourceUrl"],
            }))
            with self.assertRaises(proof.StopCollectionError):
                proof.cached_json()
        finally:
            proof.sys.stdin = old_stdin
        self.assertEqual(self.request_calls, [])


if __name__ == "__main__":
    unittest.main()
