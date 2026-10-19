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
        if parsed.path in ("/Report/CpDocketSheet", "/Report/MdjDocketSheet"):
            query = parse_qs(parsed.query, keep_blank_values=True)
            docket = query.get("docketNumber", [])
            return (method == "GET" and len(docket) == 1
                    and bool(re.fullmatch(
                        r"CP-02-CR-\d{7}-\d{4}" if parsed.path == "/Report/CpDocketSheet"
                        else r"MJ-\d{5}-(?:CR|NT)-\d{7}-\d{4}", docket[0]))
                    and len(query.get("dnh", [])) <= 1
                    and set(query) <= {"docketNumber", "dnh"})
        return False
    except (ValueError, TypeError):
        return False


def classify_response(status, headers, body, pdf=False, path=None):
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
    content_type = next(
        (value for key, value in headers.items() if key.lower() == "content-type"), ""
    )
    media_type = content_type.split(";", 1)[0].strip().lower()
    expected_types = {
        "/CaseSearch": {"text/html"},
        "/resource/js/sitemain.min.js": {
            "application/javascript", "text/javascript",
        },
        "/resource/css/sitemain.min.css": {"text/css"},
    }
    if path in expected_types and media_type not in expected_types[path]:
        return "UNSUPPORTED_RESPONSE"
    html = media_type == "text/html" or body.lstrip().lower().startswith((b"<html", b"<!doctype"))
    if html:
        if re.search(rb"verify you are human|cf-chl-|g-recaptcha|hcaptcha", body, re.I):
            return "CHALLENGE"
        if re.search(rb"too many requests|too many attempts", body, re.I):
            return "RATE_LIMIT"
        if re.search(rb"access denied", body, re.I):
            return "ACCESS_DENIED"
        if path == "/CaseSearch" and (
            re.search(rb"<input\b(?=[^>]*\btype\s*=\s*['\"]?password\b)[^>]*>", body, re.I)
            or re.search(
                rb"<form\b(?=[^>]*\b(?:action|class|id|name)\s*=\s*['\"][^'\"]*"
                rb"(?:login|sign[-_ ]?in))[^>]*>",
                body, re.I,
            )
            or re.search(rb"<title\b[^>]*>\s*(?:login|sign\s+in)\b", body, re.I)
            or re.search(
                rb"\b(?:please\s+)?(?:log\s+in|sign\s+in)\s+to\s+"
                rb"(?:continue|access)\b|\bsession\s+(?:has\s+)?expired\b",
                body, re.I,
            )
        ):
            return "LOGIN_PROMPT"
    if pdf and not body.startswith(b"%PDF-"):
        return "INVALID_PDF"
    return "OK"
