"""Kernel-enforced egress checks using local TCP/UDP canaries only."""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import ProxyHandler, build_opener


ROOT = Path(__file__).resolve().parents[1]
UJS = ROOT / "src" / "ujs"
sys.path.insert(0, str(UJS))
import network_sandbox


class _CanaryHandler(BaseHTTPRequestHandler):
    hits = Counter()
    lock = threading.Lock()

    def do_GET(self):
        with self.lock:
            self.hits[self.path] += 1
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/redirect-target")
            self.end_headers()
        else:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"local-canary")

    def log_message(self, *_args):
        pass


class InspectionNetworkSandboxTests(unittest.TestCase):
    def setUp(self):
        _CanaryHandler.hits.clear()
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), _CanaryHandler)
        self.http_thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.http_thread.start()

        self.dns = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.dns.bind(("127.0.0.1", 0))
        self.dns.settimeout(0.1)
        self.dns_hits = []
        self.dns_stop = threading.Event()

        def receive_dns():
            while not self.dns_stop.is_set():
                try:
                    payload, address = self.dns.recvfrom(2048)
                    self.dns_hits.append((payload, address))
                except socket.timeout:
                    continue
                except OSError:
                    return

        self.dns_thread = threading.Thread(target=receive_dns, daemon=True)
        self.dns_thread.start()

    def tearDown(self):
        self.dns_stop.set()
        self.dns.close()
        self.http.shutdown()
        self.http.server_close()
        self.dns_thread.join(timeout=1)
        self.http_thread.join(timeout=1)

    def test_runtime_is_pinned_to_the_reviewed_workspace_binaries(self):
        network_sandbox.verify_inspection_runtime()

    def test_missing_seccomp_support_raises_before_worker_exec(self):
        import errno
        from unittest.mock import patch

        class NoSeccomp:
            def prctl(self, *_args):
                return -1

        with patch.object(network_sandbox.ctypes, "CDLL", return_value=NoSeccomp()), \
                patch.object(network_sandbox.ctypes, "get_errno", return_value=errno.EPERM):
            with self.assertRaises(OSError):
                network_sandbox.install_default_deny()

    def test_actual_chromium_descendants_cannot_reach_canary_http_or_dns(self):
        http_port = self.http.server_address[1]
        dns_port = self.dns.getsockname()[1]

        # Prove the controlled endpoint is live before using it as a canary.
        opener = build_opener(ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{http_port}/baseline", timeout=3) as response:
            self.assertEqual(response.read(), b"local-canary")
        with _CanaryHandler.lock:
            self.assertEqual(_CanaryHandler.hits["/baseline"], 1)
            _CanaryHandler.hits.clear()

        env = os.environ.copy()
        proxy = f"http://127.0.0.1:{http_port}/proxy"
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
                    "http_proxy", "https_proxy", "all_proxy",
                    "SOCKS_PROXY", "socks_proxy"):
            env[key] = proxy
        probe = ROOT / "tests" / "inspection_sandbox_probe.py"
        sandbox = UJS / "network_sandbox.py"
        result = subprocess.run(
            [sys.executable, str(sandbox), str(probe), str(http_port), str(dns_port)],
            cwd=ROOT, env=env, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        self.assertTrue(lines, msg=result.stdout)
        observation = json.loads(lines[-1])

        import errno
        self.assertEqual(observation["ipv4TcpErrno"], errno.EPERM)
        self.assertEqual(observation["ipv4UdpErrno"], errno.EPERM)
        self.assertEqual(observation["ipv6TcpErrno"], errno.EPERM)
        self.assertEqual(observation["packetErrno"], errno.EPERM)
        self.assertEqual(observation["dnsErrno"], errno.EPERM)
        self.assertEqual(observation["proxyVariables"], [])
        self.assertTrue(observation["browserStarted"])
        self.assertGreater(observation["browserFailedRequestCount"], 0)
        self.assertTrue({"/image", "/redirect"} <= set(observation["browserRequestedPaths"]))
        self.assertTrue(observation["websocketAttempted"])

        # Includes the redirect source/target, websocket, iframe, preconnect,
        # and inherited-proxy canary paths. None reached the egress observer.
        time.sleep(0.2)
        with _CanaryHandler.lock:
            self.assertEqual(dict(_CanaryHandler.hits), {})
        self.assertEqual(self.dns_hits, [])
