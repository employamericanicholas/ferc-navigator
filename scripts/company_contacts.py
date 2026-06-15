#!/usr/bin/env python3
"""Build a contact sheet (Name / Title / Phone / Email / Address) for a company.

Pulls a company's FERC filings over the last N years, reads each PDF's text
layer, parses the signature blocks, and writes a de-duplicated CSV. This is the
exhaustive, offline counterpart to the website's Companies tab (no browser caps).

Requires pypdf:  pip install pypdf

Usage:
    python3 company_contacts.py "COMPANY NAME" [years] [out.csv]

Examples:
    python3 company_contacts.py "PJM Interconnection, L.L.C."
    python3 company_contacts.py "Duke Energy Carolinas, LLC" 5 duke_contacts.csv

Notes:
  * FERC's company filter is fuzzy, so results are filtered client-side to the
    exact company. Scanned-image filings have no text and yield nothing.
  * Extraction is best-effort; verify against FERC's Service List.
"""
import csv
import io
import json
import re
import sys
import time
import urllib.request
from datetime import date

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("This script needs pypdf. Install it with:  pip install pypdf")

API = "https://elibrary.ferc.gov/eLibrarywebapi/api"
PER_PAGE = 100
MAX_PDF_PAGES = 8

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}")
TITLE = re.compile(r"(President|Vice President|Counsel|Attorney|Director|Manager|Secretary|"
                   r"Officer|Regulatory|Affairs|Analyst|Engineer|Specialist|Consultant|Chief|"
                   r"Partner|Associate|Paralegal|Administrator|Executive|Advisor|Representative|Agent)", re.I)
ADDR = re.compile(r"(\d+\s+\w+.*(Street|St\.|Avenue|Ave\.|Boulevard|Blvd|Road|Rd\.|Lane|Ln\.|"
                  r"Drive|Dr\.|Suite|Floor|NW|NE|SW|SE|P\.?O\.?\s*Box))|"
                  r"([A-Z][a-zA-Z]+,?\s*[A-Z]{2}\s+\d{5})")
ORG = re.compile(r"(L\.?L\.?C|L\.?L\.?P|Inc\.|Corp|Compan(y|ies)|Commission|Energy|Power|"
                 r"Associates|P\.?C\.?|Partners|Group|Authority|Cooperative|Utilities|Electric|Gas)\b", re.I)


def post(path, body, raw=False):
    req = urllib.request.Request(API + "/" + path, data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read() if raw else json.load(r)


def search_page(company, sd, ed, page):
    body = {
        "searchText": "*", "searchFullText": False, "searchDescription": True,
        "dateSearches": [{"dateType": "filed_date", "startDate": sd, "endDate": ed}],
        "availability": None, "affiliations": [{"affiliation": company}], "categories": [],
        "libraries": [], "accessionNumber": None, "eFiling": False, "docketSearches": [],
        "resultsPerPage": PER_PAGE, "curPage": page, "classTypes": [], "sortBy": "",
        "groupBy": "NONE", "idolResultID": "", "allDates": False,
    }
    return post("Search/AdvancedSearch", body)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def looks_like_name(line):
    if not line or EMAIL.search(line) or PHONE.search(line):
        return False
    if TITLE.search(line) or ADDR.search(line) or ORG.search(line):
        return False
    words = re.sub(r"^/s/\s*", "", line).strip().split()
    if not (2 <= len(words) <= 5):
        return False
    return all(re.match(r"^[A-Z][A-Za-z.'’-]*\.?$", w) for w in words)


def parse_structured(lines):
    out, seen = [], set()
    for i, line in enumerate(lines):
        m = EMAIL.search(line)
        if not m:
            continue
        email = m.group(0).rstrip(".,;)").lower()
        if email in seen:
            continue
        seen.add(email)
        lo = max(0, i - 6)
        phone = ""
        for j in range(lo, i + 1):
            pm = PHONE.search(lines[j])
            if pm and len(re.sub(r"\D", "", pm.group(0))) >= 10:
                phone = pm.group(0)
        addrs = [lines[j] for j in range(lo, i + 1) if ADDR.search(lines[j])]
        address = ", ".join(dict.fromkeys(addrs))
        name, title = "", ""
        for j in range(i, lo - 1, -1):
            if looks_like_name(lines[j]):
                name = re.sub(r"^/s/\s*", "", lines[j]).strip()
                for k in range(j + 1, min(len(lines), j + 4)):
                    if TITLE.search(lines[k]) and not EMAIL.search(lines[k]) and not PHONE.search(lines[k]):
                        title = lines[k]
                        break
                break
        out.append({"name": name, "title": title, "phone": phone, "email": email, "address": address})
    return out


def pdf_lines(blob):
    reader = PdfReader(io.BytesIO(blob))
    lines = []
    for pg in reader.pages[:MAX_PDF_PAGES]:
        try:
            for ln in (pg.extract_text() or "").splitlines():
                ln = re.sub(r"\s+", " ", ln).strip()
                if ln:
                    lines.append(ln)
        except Exception:  # noqa: BLE001
            pass
    return lines


def author_orgs(hit):
    return [a.get("affiliation", "") for a in (hit.get("affiliations") or []) if a.get("afType") == "AUTHOR"]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    company = sys.argv[1]
    years = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    out_path = sys.argv[3] if len(sys.argv) > 3 else f"{re.sub(r'[^A-Za-z0-9]+', '_', company)[:40]}_contacts.csv"

    today = date.today()
    sd = f"{today.month:02d}/{today.day:02d}/{today.year - years}"
    ed = f"{today.month:02d}/{today.day:02d}/{today.year}"
    target = norm(company)

    contacts, seen = [], set()
    page, total, matched, withtext = 1, None, 0, 0
    while True:
        data = search_page(company, sd, ed, page)
        if total is None:
            total = data.get("totalHits", 0)
            print(f"{company}: scanning up to {total} fuzzy matches over {years}y for exact-company filings...")
        hits = data.get("searchHits") or []
        if not hits:
            break
        for h in hits:
            if not any(norm(o) and (norm(o) == target or target in norm(o) or norm(o) in target)
                       for o in author_orgs(h)):
                continue
            matched += 1
            acc = h.get("acesssionNumber") or h.get("accessionNumber") or ""
            docket = (h.get("docketNumbers") or [""])[0]
            pdfs = [t for t in (h.get("transmittals") or []) if t.get("fileType") == "PDF"]
            pdfs.sort(key=lambda t: 0 if re.search(r"transmit|letter|cover|sig", t.get("fileName", ""), re.I) else 1)
            for t in pdfs[:2]:
                try:
                    blob = post("File/DownloadP8File", {"fileidLst": [t["fileId"]]}, raw=True)
                    lines = pdf_lines(blob)
                    time.sleep(0.3)
                except Exception as e:  # noqa: BLE001
                    print(f"  {acc}: {e}")
                    continue
                if len(" ".join(lines)) > 30:
                    withtext += 1
                for c in parse_structured(lines):
                    key = (c["email"] or f"{c['name']}|{c['phone']}").strip().lower()
                    if not key or key == "|" or key in seen:
                        continue
                    seen.add(key)
                    c["source_accession"], c["source_docket"] = acc, docket
                    contacts.append(c)
            print(f"  matched {matched} | contacts {len(contacts)}", end="\r")
        if page * PER_PAGE >= total:
            break
        page += 1

    fields = ["name", "title", "phone", "email", "address", "source_accession", "source_docket"]
    contacts.sort(key=lambda c: (c["name"] or "~").lower())
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(contacts)
    print(f"\nWrote {len(contacts)} contacts from {matched} filings ({withtext} readable) to {out_path}")


if __name__ == "__main__":
    main()
