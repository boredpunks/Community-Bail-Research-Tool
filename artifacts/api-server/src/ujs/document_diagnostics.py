"""Bounded refusal diagnostics, never arbitrary source prose or party data."""
from email.utils import parsedate_to_datetime, format_datetime
import html
import math
import re

HEADERS = ("server", "via", "retry-after", "www-authenticate", "date")
MEDIA_TYPES = ("text/plain", "text/html", "application/pdf", "application/json",
               "application/octet-stream")
PHRASES = ("Unauthorized request", "Access denied", "Too many requests", "Forbidden",
           "Rate limit exceeded", "Authentication required", "Please try again later")
PRODUCT = r"(?:nginx|cloudflare|envoy|Apache|Microsoft-IIS|Varnish|ATS|awselb)(?:/\d+(?:\.\d+){0,3})?"


def safe_header(name, value):
    value = str(value).strip()
    if name in ("date", "retry-after") and not value.isdigit():
        try:
            value = format_datetime(parsedate_to_datetime(value), usegmt=True)
        except (ValueError, TypeError, OverflowError):
            return "[redacted]"
    if name == "date":
        return value[:200] if re.fullmatch(
            r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} "
            r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT",
            value) else "[redacted]"
    if name == "retry-after":
        return value[:200] if re.fullmatch(r"\d{1,10}", value) else safe_header("date", value)
    if name == "www-authenticate":
        # Scheme only: realms and credentials can contain identifiers/tokens.
        scheme = value.split(" ", 1)[0]
        return scheme if scheme in ("Basic", "Bearer", "Digest", "Negotiate") else "[redacted]"
    return value[:200] if re.fullmatch(
        PRODUCT if name == "server" else rf"\d(?:\.\d)? {PRODUCT}", value, re.I) else "[redacted]"


def safe_excerpt(body):
    text = html.unescape(body[:8192].decode("utf-8", errors="replace"))
    text = re.sub(r"<[^>]*>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    # Reject entire diagnostics that contain a URL/query/credential/identity
    # marker. Arbitrary residual prose is never copied, even if it looks benign.
    if re.search(r"https?://|www\.|[?@=&]|cookie|token|dnh|authorization", text, re.I):
        return "[redacted]"
    # Closed vocabulary is deliberately stricter than regex-only PII removal:
    # regex cannot establish whether an arbitrary pair of words is a name.
    matches = list(re.finditer("|".join(re.escape(p) for p in PHRASES), text, re.I))
    phrases = []
    for match in matches:
        phrase = next(p for p in PHRASES if p.lower() == match.group().lower())
        if len(" ".join(phrases + [phrase])) > 200:
            break
        phrases.append(phrase)
    return " ".join(phrases) or "[redacted]"


def denial_evidence(status, headers, body):
    if status not in (401, 403, 429):
        return None
    media_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    result = {
        "status": status,
        "mediaType": media_type if media_type in MEDIA_TYPES else "other",
        "byteCount": len(body),
        "headers": {key: safe_header(key, headers[key]) for key in HEADERS if key in headers},
    }
    length = str(headers.get("content-length", ""))
    if re.fullmatch(r"\d{1,15}", length):
        result["contentLength"] = int(length)
    if media_type in ("text/plain", "text/html"):
        result["excerpt"] = safe_excerpt(body)
    return result


def link_elapsed_seconds(captured_at, get_started_at):
    if captured_at is None:
        return None  # Resumed old actions have no trustworthy capture instant.
    elapsed = get_started_at - captured_at
    if not math.isfinite(elapsed) or elapsed < 0:
        raise ValueError("INVALID_LINK_CAPTURE_TIMING")
    return round(elapsed, 6)
