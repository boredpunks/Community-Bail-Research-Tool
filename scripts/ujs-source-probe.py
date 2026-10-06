"""Retired diagnostic. Use the app's persisted, shared-limiter discovery job.

HTML and session cookies stay in a private temporary directory. Redirects are
not automatic: every HTTP request must be explicitly run and counted.
"""
import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request


def main():
    raise SystemExit("Retired standalone probe: use Live discovery in the app so all source traffic shares the persisted limiter and accounting.")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--form", help="Private local JSON file of form fields")
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.url)
    if url.scheme != "https" or url.hostname != "ujsportal.pacourts.us" or url.port not in (None, 443) or url.username or url.password:
        parser.error("Only the HTTPS public UJS portal is allowed")
    directory = Path("/tmp/ujs-source-proof")
    directory.mkdir(mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    state_path = directory / "ledger.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else []
    if len(state) >= 8:
        parser.error("Eight-request diagnostic budget exhausted")
    if state and state[-1].get("status") in (403, 429):
        parser.error("Source denied or rate-limited access; do not retry")
    if state:
        time.sleep(max(0, 30 - (time.time() - state[-1]["startedEpoch"])))
    cookies = http.cookiejar.MozillaCookieJar(str(directory / "session.txt"))
    if Path(cookies.filename).exists():
        cookies.load(ignore_discard=True, ignore_expires=False)

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = urllib.request.build_opener(
        NoRedirect(), urllib.request.HTTPCookieProcessor(cookies)
    )
    data = None
    if args.form:
        data = urllib.parse.urlencode(json.loads(Path(args.form).read_text())).encode()
    headers = {
        "User-Agent": "CommunityBailResearch-SourceAssessment/1.0",
        "Accept": "text/html,application/pdf",
    }
    if data is not None:
        headers.update({
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://ujsportal.pacourts.us",
            "Referer": "https://ujsportal.pacourts.us/CaseSearch",
        })
    request = urllib.request.Request(args.url, data=data, headers=headers)
    entry = {"number": len(state) + 1, "startedEpoch": time.time(),
             "url": args.url, "method": "POST" if data else "GET"}
    state.append(entry)
    state_path.write_text(json.dumps(state, indent=2))
    try:
        try:
            response = opener.open(request, timeout=45)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            entry["status"] = response.status
            entry["contentType"] = response.headers.get("Content-Type", "")
            entry["location"] = response.headers.get("Location")
            body = response.read(4_000_001)
            if len(body) > 4_000_000:
                raise ValueError("Response exceeds diagnostic size limit")
            path = directory / f'response-{entry["number"]}.bin'
            path.write_bytes(body)
            entry["bytes"] = len(body)
            entry["bodyPath"] = str(path)
        cookies.save(ignore_discard=True, ignore_expires=False)
        os.chmod(cookies.filename, 0o600)
    except Exception as error:
        entry["error"] = type(error).__name__
        raise
    finally:
        state_path.write_text(json.dumps(state, indent=2))
        print(json.dumps(entry, indent=2))


if __name__ == "__main__":
    main()
