"""Header/geometry based reader for the demonstrated MDJ Originating Court table."""
import re
from decimal import Decimal

LABELS = ("Bail Action Type", "Bail Action Date", "Bail Type",
          "Originating Court", "Percentage", "Amount")
STOP = {"CHARGES", "ATTORNEY INFORMATION", "DOCKET ENTRY INFORMATION",
        "CASE INFORMATION", "CASE PARTICIPANTS", "CONFINEMENT"}


def word_lines(page):
    lines = []
    for word in sorted(page.get_text("words"), key=lambda w: (round(w[1], 1), w[0])):
        if not lines or abs(lines[-1][0][1] - word[1]) > 2:
            lines.append([word])
        else:
            lines[-1].append(word)
    return [sorted(line, key=lambda w: w[0]) for line in lines]


def read_originating_tables(body, iso_date):
    import pymupdf
    entries, excerpts, pages = [], [], []
    with pymupdf.open(stream=body, filetype="pdf") as doc:
        for number, page in enumerate(doc, 1):
            lines = word_lines(page)
            in_bail = False
            header = None
            section = []
            for line in lines:
                text = " ".join(w[4] for w in line)
                if text in ("BAIL", "BAIL INFORMATION"):
                    in_bail = True
                    continue
                if not in_bail:
                    continue
                if text in STOP:
                    break
                section.append(text)
                if "Bail Posted" in text:
                    raise ValueError("Originating-court posting table requires separate layout verification.")
                if "Originating Court" in text:
                    tokens = [w[4] for w in line]
                    anchors = []
                    consumed = set()
                    for label in LABELS:
                        parts = label.split()
                        matches = [i for i in range(len(tokens) - len(parts) + 1)
                                   if tokens[i:i + len(parts)] == parts]
                        if len(matches) != 1:
                            raise ValueError("Ambiguous MDJ column labels.")
                        i = matches[0]
                        consumed.update(range(i, i + len(parts)))
                        anchors.append((label, line[i][0], line[i + len(parts) - 1][2]))
                    if len(consumed) != len(tokens):
                        raise ValueError("Unrecognized MDJ table column.")
                    anchors.sort(key=lambda x: x[1])
                    header = anchors
                    pages.append(number)
                    continue
                if header is None:
                    if re.search(r"\d{2}/\d{2}/\d{4}|\$[\d,]", text):
                        raise ValueError("Financial row before a recognized MDJ header.")
                    continue
                if not text.strip():
                    continue
                bounds = [(header[i][2] + header[i + 1][1]) / 2
                          for i in range(len(header) - 1)]
                cells = {label: [] for label, _, _ in header}
                for word in line:
                    center = (word[0] + word[2]) / 2
                    if any(word[0] < b < word[2] for b in bounds):
                        raise ValueError("MDJ text crosses column boundaries.")
                    col = sum(center > b for b in bounds)
                    cells[header[col][0]].append(word[4])
                cells = {key: " ".join(value) for key, value in cells.items()}
                action, date = cells["Bail Action Type"], cells["Bail Action Date"]
                kind, court = cells["Bail Type"], cells["Originating Court"]
                percentage, amount = cells["Percentage"], cells["Amount"]
                categories = {"monetary": "MONETARY", "unsecured": "UNSECURED",
                              "nominal": "NOMINAL", "nonmonetary": "NONMONETARY",
                              "recognizance": "RECOGNIZANCE", "denied": "DENIED"}
                if (not re.fullmatch(r"Set|Changed|Modified|Denied|Revoked|Increased|Reduced|Bail Set", action, re.I)
                        or iso_date(date) is None or kind.lower() not in categories or not court
                        or not re.fullmatch(r"\$(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}", amount)
                        or percentage and not re.fullmatch(r"\d+(?:\.\d+)?%?|N/A|--", percentage)):
                    raise ValueError("An MDJ row is incomplete or ambiguous; no guessed values.")
                cents = int(Decimal(amount[1:].replace(",", "")) * 100)
                if cents > 2147483647:
                    raise ValueError("MDJ amount exceeds storage bounds.")
                category = categories[kind.lower()]
                conditional = percentage not in ("", "N/A", "--", "0", "0%")
                basis = None if conditional else (
                    "UNSECURED_AMOUNT" if category == "UNSECURED" else
                    "TOTAL_BAIL" if category in ("MONETARY", "NOMINAL") else None)
                entries.append({
                    "action": action, "wording": kind, "orderDate": iso_date(date),
                    "bailCategory": category, "amountCents": cents, "financialBasis": basis,
                    "originatingCourt": court, "percentageCondition": percentage or None,
                    "sourcePages": [number],
                })
            if header is not None:
                excerpts.append("\n".join(section))
    if not entries:
        raise ValueError("No fully interpreted originating-court rows.")
    excerpt = "\n".join(excerpts)
    if len(excerpt) > 4000:
        raise ValueError("MDJ bail excerpt exceeds the complete evidence limit.")
    return entries, excerpt, sorted(set(pages))
