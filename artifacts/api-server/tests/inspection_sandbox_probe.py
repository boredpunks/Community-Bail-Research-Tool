"""Subprocess target for the seccomp/Chromium egress test; local endpoints only."""
import asyncio
import json
import os
import shutil
import socket
import sys
from urllib.parse import urlsplit

from playwright.async_api import async_playwright


def denied_socket(family, kind):
    try:
        sock = socket.socket(family, kind)
    except OSError as error:
        return error.errno
    else:
        sock.close()
        return None


async def main(http_port, dns_port, unix_path):
    results = {
        "ipv4TcpErrno": denied_socket(socket.AF_INET, socket.SOCK_STREAM),
        "ipv4UdpErrno": denied_socket(socket.AF_INET, socket.SOCK_DGRAM),
        "ipv6TcpErrno": denied_socket(socket.AF_INET6, socket.SOCK_STREAM),
        "packetErrno": denied_socket(socket.AF_PACKET, socket.SOCK_RAW),
        "unixStreamErrno": denied_socket(socket.AF_UNIX, socket.SOCK_STREAM),
        "unixDatagramErrno": denied_socket(socket.AF_UNIX, socket.SOCK_DGRAM),
        "proxyVariables": sorted(
            key for key in os.environ
            if key.lower() in {
                "http_proxy", "https_proxy", "all_proxy", "no_proxy",
                "ftp_proxy", "ws_proxy", "wss_proxy", "socks_proxy",
            }
        ),
    }
    left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
    left.send(b"paired-ipc")
    results["pairedIpcWorks"] = right.recv(32) == b"paired-ipc"
    try:
        left.connect(unix_path)
        results["unixConnectErrno"] = None
    except OSError as error:
        results["unixConnectErrno"] = error.errno
    try:
        left.sendmsg([b"controlled-unix-canary"], [], 0, unix_path)
        results["unixNamedSendErrno"] = None
    except OSError as error:
        results["unixNamedSendErrno"] = error.errno
    left.close()
    right.close()
    try:
        left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
        left.close()
        right.close()
        results["unixDatagramPairErrno"] = None
    except OSError as error:
        results["unixDatagramPairErrno"] = error.errno

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=shutil.which("chromium"),
            headless=True,
            args=["--disable-background-networking", "--disable-component-update",
                  "--disable-sync", "--no-first-run", "--no-sandbox",
                  "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND"],
        )
        context = await browser.new_context(service_workers="block")
        page = await context.new_page()
        failed_requests = []
        requested_paths = set()
        websocket_urls = []
        page.on("request", lambda request: requested_paths.add(
            urlsplit(request.url).path))
        page.on("requestfailed", lambda request: failed_requests.append(request.url))
        page.on("websocket", lambda websocket: websocket_urls.append(websocket.url))
        await page.set_content(f"""
          <link rel="preconnect" href="http://127.0.0.1:{http_port}" crossorigin>
          <link rel="preconnect" href="http://dns-canary.test" crossorigin>
          <img src="http://127.0.0.1:{http_port}/image">
          <iframe src="http://127.0.0.1:{http_port}/redirect"></iframe>
          <script>
            fetch("http://127.0.0.1:{http_port}/redirect", {{mode: "no-cors"}}).catch(() => {{}});
            try {{ new WebSocket("ws://127.0.0.1:{http_port}/socket"); }} catch (_) {{}}
          </script>
        """, wait_until="load", timeout=8_000)
        await page.wait_for_timeout(500)
        await browser.close()
        results["browserStarted"] = True
        results["browserFailedRequestCount"] = len(failed_requests)
        results["browserRequestedPaths"] = sorted(requested_paths)
        results["websocketAttempted"] = any(
            urlsplit(url).path == "/socket" for url in websocket_urls)

    # Simulate an explicit DNS datagram and a direct network attempt from the
    # worker process. Socket creation must fail before either canary sees them.
    try:
        dns = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        dns.sendto(b"controlled-dns-probe", ("127.0.0.1", dns_port))
        dns.close()
        results["dnsErrno"] = None
    except OSError as error:
        results["dnsErrno"] = error.errno
    print(json.dumps(results), flush=True)


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]))
