"""Pure request/response checks shared by collection and assessment."""
import re
from urllib.parse import urlsplit, parse_qs, parse_qsl


CALENDAR_ASSETS = ("/resource/js/sitemain.min.js", "/resource/css/sitemain.min.css")


def allowed_asset_query(query):
    """Only the known bundle's bounded cache-version hash, never arbitrary keys."""
    if not query:
        return True
    if len(query) > 256:
        return False
    try:
        pairs = parse_qsl(query, keep_blank_values=True, strict_parsing=True)
        return (len(pairs) == 1 and pairs[0][0] == "v"
                and re.fullmatch(r"[A-Za-z0-9_-]{16,128}", pairs[0][1]) is not None)
    except ValueError:
        return False


def allowed(url, method):
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.hostname != "ujsportal.pacourts.us"
                or parsed.port not in (None, 443) or parsed.username or parsed.password
                or parsed.fragment):
            return False
        if parsed.path == "/CaseSearch":
            return method in ("GET", "POST") and not parsed.query
        if parsed.path in CALENDAR_ASSETS:
            return method == "GET" and allowed_asset_query(parsed.query)
        if parsed.path == "/Report/CpDocketSheet":
            query = parse_qs(parsed.query, keep_blank_values=True)
            docket = query.get("docketNumber", [])
            return (method == "GET" and len(docket) == 1
                    and bool(re.fullmatch(r"CP-02-CR-\d{7}-\d{4}", docket[0]))
                    and len(query.get("dnh", [])) <= 1
                    and set(query) <= {"docketNumber", "dnh"})
        return False
    except (ValueError, TypeError):
        return False


def classify_response(status, headers, body, pdf=False):
    if status == 429:
        return "RATE_LIMIT"
    if status in (401, 403):
        return "ACCESS_DENIED"
    if 300 <= status < 400:
        return "REDIRECT"
    if status != 200:
        return "HTTP_ERROR"
    if len(body) > 4_000_000:
        return "SIZE_LIMIT"
    html = "text/html" in headers.get("content-type", "").lower() or body.lstrip().lower().startswith((b"<html", b"<!doctype"))
    if html:
        if re.search(rb"verify you are human|cf-chl-|g-recaptcha|hcaptcha", body, re.I):
            return "CHALLENGE"
        if re.search(rb"too many requests|too many attempts", body, re.I):
            return "RATE_LIMIT"
        if re.search(rb"access denied", body, re.I):
            return "ACCESS_DENIED"
    if pdf and not body.startswith(b"%PDF-"):
        return "INVALID_PDF"
    return "OK"
