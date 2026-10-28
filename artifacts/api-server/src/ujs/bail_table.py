"""Geometry-mapped recorded bail amounts from demonstrated CP and MDJ tables."""
import hashlib
import json
import re
from decimal import Decimal
from mdj_table import word_lines

STOP = {"CHARGES", "ATTORNEY INFORMATION", "DOCKET ENTRY INFORMATION",
        "CASE INFORMATION", "CASE PARTICIPANTS", "CONFINEMENT",
        "CALENDAR EVENTS", "DEFENDANT INFORMATION", "CASE FINANCIAL INFORMATION"}
CATEGORIES = {"monetary": "MONETARY", "unsecured": "UNSECURED",
              "nominal": "NOMINAL", "nonmonetary": "NONMONETARY",
              "non-monetary": "NONMONETARY", "recognizance": "RECOGNIZANCE",
              "denied": "DENIED"}


class FinancialAssociationError(ValueError):
    pass


def header_columns(line):
    tokens = [word[4] for word in line]
    is_mdj = "Type" in tokens[:4]
    labels = (("Bail Action Type", "Bail Action Date") if is_mdj else ("Bail Action", "Date"))
    labels += ("Bail Type", "Originating Court", "Percentage", "Amount")
    anchors, consumed = [], set()
    for label in labels:
        parts = label.split()
        matches = [i for i in range(len(tokens) - len(parts) + 1)
                   if tokens[i:i + len(parts)] == parts]
        if len(matches) != 1:
            raise ValueError("Ambiguous recorded-amount table header.")
        start = matches[0]
        consumed.update(range(start, start + len(parts)))
        anchors.append((label, line[start][0], line[start + len(parts) - 1][2]))
    if len(consumed) != len(tokens):
        raise ValueError("Unrecognized bail table column.")
    return sorted(anchors, key=lambda anchor: anchor[1])


def cells_for_line(line, header):
    bounds = [(header[i][2] + header[i + 1][1]) / 2 for i in range(len(header) - 1)]
    cells = [[] for _ in header]
    for word in line:
        if any(word[0] < bound < word[2] for bound in bounds):
            raise FinancialAssociationError("Financial text crosses a verified column boundary.")
        column = sum((word[0] + word[2]) / 2 > bound for bound in bounds)
        cells[column].append(word[4])
    return [" ".join(cell) for cell in cells]


def stable_entries(entries):
    unique = {}
    for entry in entries:
        identity = {key: entry.get(key) for key in (
            "action", "orderDate", "bailCategory", "amountCents",
            "financialBasis", "percentageCondition", "originatingCourt")}
        key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        entry["sourceEntryId"] = key
        if key in unique:
            unique[key]["sourcePages"] = sorted(set(unique[key]["sourcePages"] + entry["sourcePages"]))
        else:
            unique[key] = entry
    return list(unique.values())


def bail_row_entry(cells, text, number, iso_date):
    action, date, kind, court, percentage, money = cells
    action_denied = bool(re.fullmatch(
        r"(?:Denied|Deny\s*\(\s*bail\s+modification\s*\))", action, re.I))
    if (not action or iso_date(date) is None or not court
            or (not kind and not action_denied)
            or (kind and kind.lower() not in CATEGORIES)
            or percentage and not re.fullmatch(r"\d+(?:\.\d+)?%?|N/A|--", percentage)):
        raise FinancialAssociationError(
            "Bail row has unresolved action, date, category or percentage association.")

    if action_denied and kind and kind.lower() != "denied":
        raise FinancialAssociationError("Denied action conflicts with the recorded bail category.")
    category = "DENIED" if action_denied else CATEGORIES[kind.lower()]
    wording = kind or "Denied"

    basis, cents = None, None
    if category == "DENIED":
        if (percentage not in ("", "N/A", "--")
                and Decimal(percentage.rstrip("%")) != 0):
            raise FinancialAssociationError("Denied action has an unexpected percentage condition.")
        if money and (
            not re.fullmatch(r"\$(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}", money)
            or Decimal(money[1:].replace(",", "")) != 0
        ):
            raise FinancialAssociationError("Denied action has a nonzero or unrecognized amount.")
    elif category in ("MONETARY", "NOMINAL", "UNSECURED"):
        if not re.fullmatch(r"\$(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}", money):
            raise FinancialAssociationError("Recorded Amount column is missing or ambiguous.")
        cents = int(Decimal(money[1:].replace(",", "")) * 100)
        if cents > 2147483647:
            raise FinancialAssociationError("Recorded amount exceeds supported storage bounds.")
        conditional = percentage not in ("", "N/A", "--") and Decimal(percentage.rstrip("%")) != 0
        basis = ("UNSECURED_AMOUNT" if category == "UNSECURED" else
                 "RECORDED_BAIL_AMOUNT" if conditional else "TOTAL_BAIL")

    return {
        "action": action, "wording": wording, "orderDate": iso_date(date),
        "bailCategory": category, "amountCents": cents, "financialBasis": basis,
        "originatingCourt": court, "percentageCondition": percentage or None,
        "sourcePages": [number], "excerpt": text,
    }


def read_bail_tables(body, iso_date):
    import pymupdf
    entries, excerpts, section_pages = [], [], []
    posted = "NOT_SHOWN"
    with pymupdf.open(stream=body, filetype="pdf") as document:
        for number, page in enumerate(document, 1):
            in_bail, posting, header = False, False, None
            section = []
            posting_header = None
            pending_row = None

            def flush_pending_row():
                nonlocal pending_row
                if pending_row is None:
                    return
                cells, text = pending_row
                entries.append(bail_row_entry(cells, text, number, iso_date))
                section.append(text)
                pending_row = None

            for line in word_lines(page):
                text = " ".join(word[4] for word in line)
                if text in ("BAIL", "BAIL INFORMATION"):
                    flush_pending_row()
                    in_bail = True
                    section_pages.append(number)
                    continue
                if not in_bail:
                    continue
                if text in STOP or text.startswith(("CPCMS ", "MDJS ", "Printed:")):
                    break
                # Never retain the name/Nebbia line above the column labels.
                if "Bail Posted" in text:
                    flush_pending_row()
                    posting = True
                    continue
                if posting:
                    if "Posting Status" in text:
                        words = [word[4] for word in line]
                        index = words.index("Posting")
                        posting_header = (line[index][0], line[index + 1][2])
                    elif posting_header and re.search(r"\bPosted\b", text, re.I):
                        states = [word[4] for word in line
                                  if posting_header[0] - 2 <= word[0] <= posting_header[1] + 2]
                        state = " ".join(states).strip().lower()
                        if state == "posted":
                            posted = "SHOWN_POSTED"
                        elif state not in ("not posted", "unposted", ""):
                            posted = "UNKNOWN"
                    elif re.search(r"\$\d|\d{2}/\d{2}/\d{4}", text) and posting_header is None:
                        raise FinancialAssociationError("Posting table lacks a verified status column.")
                    continue
                if "Originating Court" in text and "Amount" in text:
                    flush_pending_row()
                    header = header_columns(line)
                    section.append(text)
                    continue
                if header is None:
                    if re.search(r"\$\d|\d{2}/\d{2}/\d{4}", text):
                        raise FinancialAssociationError("Financial row appears before a recognized setting header.")
                    continue
                if not text.strip():
                    continue
                cells = cells_for_line(line, header)
                if pending_row is not None:
                    pending_cells, pending_text = pending_row
                    continuation = (not any(cells[1:]) and cells[0]
                                    and pending_cells[0].count("(") > pending_cells[0].count(")")
                                    and re.fullmatch(r"[A-Za-z -]+\)", cells[0]))
                    if continuation:
                        pending_cells[0] += " " + cells[0]
                        pending_row = (pending_cells, pending_text + "\n" + text)
                        continue
                    flush_pending_row()
                pending_row = (cells, text)
            flush_pending_row()
            if header is not None:
                excerpts.extend(section)
    if not entries:
        raise ValueError("No fully interpreted recorded bail-setting rows.")
    excerpt = "\n".join(excerpts)
    if len(excerpt) > 4000:
        raise ValueError("Complete bail chronology exceeds the evidence excerpt limit.")
    return stable_entries(entries), excerpt, sorted(set(section_pages)), posted
