import html as H, http.cookiejar, re, sys, time, urllib.error, urllib.parse, urllib.request

UA = "CommunityBailResearch-SourceAssessment/1.0"
BASE = "https://ujsportal.pacourts.us"
start, end = (sys.argv[1], sys.argv[2]) if len(sys.argv) == 3 else ("2026-10-19", "2026-10-23")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(jar))

def call(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "text/html,application/pdf", **(headers or {})})
    try:
        r = opener.open(req, timeout=45)
    except urllib.error.HTTPError as e:
        r = e
    except Exception as e:
        return None, {}, b"", type(e).__name__
    return r.status, dict(r.headers.items()), r.read(6_000_000), ""

def report(step, status, headers, body, err):
    print(f"{step}: status={status} content-type={headers.get('Content-Type') or headers.get('content-type')} bytes={len(body)} error={err or '-'}")
    return status == 200

s, h, b, e = call(BASE + "/CaseSearch")
if not report("1 GET search form", s, h, b, e): sys.exit("STOP: search form refused")
page = b.decode("utf-8", "replace")
token = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', page).group(1)
i = page.find('id="case-search-form-id"'); form = page[i:page.find("</form>", i)]
fields = []
for m in re.finditer(r"<input\b[^>]*>", form):
    a = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(0)))
    if not a.get("name") or a["name"] == "__RequestVerificationToken": continue
    if a.get("type") == "checkbox" and "checked" not in m.group(0): continue
    fields.append([a["name"], H.unescape(a.get("value", ""))])
wanted = {"SearchBy": "CalendarEvent", "JudicialDistrict": "05", "CourtOffice": "CP-05-02-Crim",
          "CalendarEventType": "", "CalendarEventStartDate": start, "CalendarEventEndDate": end}
for f in fields:
    if f[0] in wanted: f[1] = wanted[f[0]]
fields.append(["__RequestVerificationToken", token])
time.sleep(5)
s, h, b, e = call(BASE + "/CaseSearch", urllib.parse.urlencode([tuple(f) for f in fields]).encode(),
                  {"Content-Type": "application/x-www-form-urlencoded", "Referer": BASE + "/CaseSearch", "Origin": BASE})
if not report("2 POST calendar search", s, h, b, e): sys.exit("STOP: search refused")
result = b.decode("utf-8", "replace")
links = re.findall(r'href="(/Report/CpDocketSheet\?[^"]+)"', result)
dockets = set(re.findall(r"CP-02-CR-\d{7}-\d{4}", result))
print(f"  result links={len(links)} distinct CP dockets={len(dockets)} no-results={'No results found' in result}")
if not links: sys.exit("STOP: no docket links to test")
time.sleep(5)
s, h, b, e = call(BASE + H.unescape(links[0]))
ok = report("3 GET one docket sheet", s, h, b, e)
print("  starts with %PDF-:", b[:5] == b"%PDF-")
print("RESULT:", "PORTAL SERVED SEARCH AND DOCKET PDF TO THIS NETWORK" if ok and b[:5] == b"%PDF-" else "REFUSED OR UNEXPECTED - STOP, do not retry or rotate anything")
