#!/usr/bin/env python3
"""Build data/companies.json — the list of companies that power the dropdown.

Scans recent FERC filings, collects the distinct AUTHOR organizations (with how
often each appears), and writes them sorted by frequency. This is a build-time
asset; re-run it periodically to refresh the dropdown.

Usage:
    python3 build_companies.py [max_filings] [out.json]

Defaults: max_filings=40000, out=../data/companies.json
"""
import json
import os
import re
import sys
import urllib.request
from datetime import date

API = "https://elibrary.ferc.gov/eLibrarywebapi/api"
PER_PAGE = 250

# FERC-internal offices / placeholders that aren't external filers.
NOISE = re.compile(
    r"(^FERC$|FERC$|FEDERAL ENERGY REGULATORY|OFFICE OF |REGIONAL OFFICE|"
    r"COMMISSIONERS|SECRETARY OF THE COMMISSION|THE COMMISSION|"
    r"INDIVIDUAL NO AFFILIATION|NO AFFILIATION|ADMINISTRATIVE LAW JUDGE|"
    r"DIVISION OF |OFFICE OF THE SECRETARY|^INDIVIDUAL$|SETTLEMENT JUDGE|"
    r"PRESIDING JUDGE|^JUDGE\b)", re.I)


def is_noise(org):
    return bool(NOISE.search(org))


def post(path, body):
    req = urllib.request.Request(API + "/" + path, data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def search_page(sd, ed, page):
    return post("Search/AdvancedSearch", {
        "searchText": "*", "searchFullText": False, "searchDescription": True,
        "dateSearches": [{"dateType": "filed_date", "startDate": sd, "endDate": ed}],
        "availability": None, "affiliations": [], "categories": [], "libraries": [],
        "accessionNumber": None, "eFiling": False, "docketSearches": [],
        "resultsPerPage": PER_PAGE, "curPage": page, "classTypes": [], "sortBy": "",
        "groupBy": "NONE", "idolResultID": "", "allDates": False,
    })


def main():
    max_filings = int(sys.argv[1]) if len(sys.argv) > 1 else 40000
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "..", "data", "companies.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    today = date.today()
    sd = f"{today.month:02d}/{today.day:02d}/{today.year - 3}"  # last 3 years
    ed = f"{today.month:02d}/{today.day:02d}/{today.year}"

    counts = {}        # display name -> count
    canon = {}         # lowercased -> canonical display name (first seen)
    page, total, seen = 1, None, 0
    while seen < max_filings:
        data = search_page(sd, ed, page)
        if total is None:
            total = data.get("totalHits", 0)
            print(f"{total} filings in range; scanning up to {max_filings}...")
        hits = data.get("searchHits") or []
        if not hits:
            break
        for h in hits:
            for a in (h.get("affiliations") or []):
                if a.get("afType") != "AUTHOR":
                    continue
                org = (a.get("affiliation") or "").strip()
                if not org or is_noise(org):
                    continue
                key = org.lower()
                name = canon.setdefault(key, org)
                counts[name] = counts.get(name, 0) + 1
        seen += len(hits)
        if page % 10 == 0 or seen >= max_filings:
            print(f"  scanned {seen}/{min(total, max_filings)} filings, {len(counts)} companies", end="\r")
            _write(out_path, counts)
        if page * PER_PAGE >= total:
            break
        page += 1

    _write(out_path, counts)
    print(f"\nWrote {len(counts)} companies to {out_path}")


def _write(out_path, counts):
    items = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump([{"name": n, "count": c} for n, c in items], fh, ensure_ascii=False)


if __name__ == "__main__":
    main()
