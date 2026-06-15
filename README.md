# ⚡ FERC Navigator

A clean, fast, **zero-backend** web interface to the entire
[FERC eLibrary](https://elibrary.ferc.gov/) — the Federal Energy Regulatory
Commission's repository of every filing, order, and document it has on record.

- 🔎 **Keyword search inside the PDFs** — searches FERC's full OCR'd text of the
  documents, not just titles.
- 🗂️ **Browse dockets, most-recent-first** — see what's been filed today, this
  week, this month, grouped by docket.
- 📄 **One-click PDF access** — download any filing's files straight from FERC.
- 📦 **Export by docket** — metadata as CSV/JSON, a bulk **ZIP of all PDFs** in
  the browser, or a standalone Python script that archives an entire docket.
- 👤 **Search by person & organization** — find every filing a named person or
  an employer has ever submitted, across all of FERC history.

It's a single static site (plain HTML/CSS/JS, no build step), so you can publish
it to GitHub Pages by just pushing the repo.

---

## "Catalog *every* FERC filing ever" — how this actually works

The original goal was to download every FERC filing ever and bundle the PDFs
into this repo. That isn't physically possible: FERC eLibrary holds **millions**
of documents totaling **many terabytes**, while a GitHub repo caps out around a
few GB (100 MB per file). No repo could hold it.

So instead of *copying* the archive, this site is a **live front-end over the
whole thing**. FERC exposes an (undocumented) JSON API, and — crucially — it
sends permissive CORS headers, so the browser can call it directly with no
server of your own. That means:

- You get access to **every docket and every filing**, always current.
- Keyword search runs against **FERC's own full-text index** of the PDFs.
- PDFs are fetched **on demand**, straight from FERC, and saved locally.

When you genuinely want the bytes on disk, the **export tools** pull the PDFs for
a docket — in-browser as a ZIP, or via the included
[`scripts/download_docket.py`](scripts/download_docket.py) for any size of docket.

---

## People & organizations ("who filed this, and who do they work for")

The **People & orgs** tab lets you:

- **Look anyone up across the entire corpus** — type a last name (optionally a
  first initial) and/or an employer. FERC filters server-side, so you get *every*
  matching filing in eLibrary, not a sample.
- **Build a full profile** — one click pages through all of a person's or
  organization's filings and aggregates their employers, the dockets they work
  in, and date range, with CSV export.
- **Browse a directory** of everyone who filed in a recent window.
- **See filers on any docket** — each docket page lists the people and
  organizations that filed there, linked to their profiles.

Every filing card also shows a **"Filed by:"** line (name + employer), and those
names/employers are clickable.

### What's available vs. what isn't — be aware
FERC's structured metadata only contains, for each filer:

- ✅ **Last name + first/middle initial** (not the full first name)
- ✅ **Employer / organization** (the "affiliation")
- ✅ The filings themselves and their dates

It does **not** expose **email, phone, or mailing address** through this API.
Those live in two places this static site can't reach directly:

1. **The PDF signature blocks** — unstructured text inside the documents.
2. **FERC's official Service List** — which *does* have emails/phones/addresses,
   but sits behind a web firewall with no public JSON/CORS access.

So for contact details there are two paths:

1. **Extract from the PDF (built in).** Every filing card has a **🔎 Find
   contacts in PDF** button. It downloads the filing's PDF(s), reads the text
   layer with [pdf.js](https://mozilla.github.io/pdf.js/) right in your browser,
   and parses the signature block for **emails, phone numbers, and the
   signatory's name/title/employer**. Works great on modern e-filings — e.g. a
   PJM tariff filing yields `craig.glazer@pjm.com`, `(202) 423-4743`, and the
   full "Respectfully submitted, Craig Glazer, Vice President…" block.

   ⚠️ Many older or third-party filings are **scanned images with no text
   layer** — those can't be parsed, and the tool says so plainly.

2. **FERC's official Service List (authoritative).** Every docket page, person
   profile, and contacts box links out to **"Contacts at FERC ↗"**, which opens
   FERC's Service List for that docket — the verified source for
   emails/phones/addresses.

### Companies tab — per-company contact sheets
The **Companies** tab is built for "who's submitting this stuff." Pick a company
from the **searchable dropdown** (or type any name), and the app pulls *that
company's* filings from the **last 5 years**, reads each PDF, and builds a table:

| Name | Title | Phone | Email | Address |
|------|-------|-------|-------|---------|

with a **CSV export** and **Scan more filings** to go deeper. Because the same
people sign a company's filings repeatedly, a modest scan surfaces the real
submitters quickly.

Why per-company instead of "all filings at once": pre-extracting *every* FERC
filing for *all* companies would mean reading millions of PDFs (terabytes) —
impossible to bundle or run in a browser. Scoping to the company you care about
gets the same answer on demand. Two caveats carry over: extraction is
**best-effort** (fields can be blank or slightly mis-paired when several people
are stacked in one signature), and **scanned-image filings yield nothing** — so
each sheet links the relevant dockets' **FERC Service Lists** for verification.

> Note: FERC's company filter is fuzzy (a search for one company also returns
> others sharing tokens like "LLC"), so the app filters client-side to the exact
> company you chose.

The dropdown is powered by **`data/companies.json`** — a pre-built list of the
companies that have filed with FERC (most active first), generated by
`scripts/build_companies.py` (it scans recent filings and de-duplicates the
author organizations, dropping FERC-internal offices). It's not literally every
org string ever, so the box also accepts free text for anything not listed.
Refresh it anytime with:
```bash
python3 scripts/build_companies.py        # rewrites data/companies.json
```

### Bulk / exhaustive company contacts (script)
For *all* of a company's filings over N years (no browser caps), into a CSV:
```bash
pip install pypdf
python3 scripts/company_contacts.py "PJM Interconnection, L.L.C."        # 5 years
python3 scripts/company_contacts.py "Duke Energy Carolinas, LLC" 5 out.csv
```
Columns: `name, title, phone, email, address, source_accession, source_docket`.

### Bulk contact extraction by docket (script)
To harvest contacts for an entire docket into a CSV:
```bash
pip install pypdf
python3 scripts/extract_contacts.py ER26-1800
```
Outputs `accession, filed_date, dockets, author, employer, emails, phones,
had_text_layer, signature_block` per filing.

---

## Publish to GitHub Pages

1. Create a new GitHub repo and push these files to it:
   ```bash
   git init
   git add .
   git commit -m "FERC Navigator"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment → Source: "Deploy from a
   branch"**, branch `main`, folder `/ (root)`. Save.
3. Wait ~1 minute. Your site is live at
   `https://<you>.github.io/<repo>/`.

(The included `.nojekyll` file tells Pages to serve everything as-is.)

### Run locally
Any static server works, e.g.:
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

---

## Using the bulk downloader script

Download every file in a docket (no browser, no size limit):
```bash
python3 scripts/download_docket.py ER26-1800
python3 scripts/download_docket.py CP26-47 ./my_pdfs
```
No dependencies — standard-library Python 3 only.

---

## How it's built

| File | Purpose |
|------|---------|
| `index.html` | App shell, header search, script includes |
| `css/style.css` | All styling |
| `js/api.js` | FERC eLibrary API client (search, file download) |
| `js/util.js` | Formatting, dates, CSV, DOM, blob saving |
| `js/app.js` | Hash router + the three views (Recent / Search / Docket) |
| `js/contacts.js` | Lazy-loads pdf.js; extracts emails/phones/signatures from PDFs |
| `js/script-template.js` | Generates the per-docket downloader script |
| `scripts/download_docket.py` | Standalone bulk PDF archiver |
| `scripts/extract_contacts.py` | Bulk contact extractor by docket (→ CSV) |
| `scripts/company_contacts.py` | Per-company contact sheet, all filings over N years (→ CSV) |
| `scripts/build_companies.py` | Builds `data/companies.json` for the company dropdown |
| `data/companies.json` | Pre-built company list powering the dropdown |

### The FERC API (reverse-engineered)
Base: `https://elibrary.ferc.gov/eLibrarywebapi/api`

- `POST Search/AdvancedSearch` — keyword/full-text search with docket, date, and
  library filters. Set `searchFullText: true` to search inside PDF text. Set
  `affiliations: [{ "lastName": "...", "firstInitial": "...", "affiliation": "..." }]`
  to filter by who filed (any subset of those keys) — this powers People search.
- `POST File/DownloadP8File` — body `{"fileidLst": ["<fileId>"]}` returns the raw
  file bytes.

These are undocumented and could change; this project is unofficial and not
affiliated with FERC. All documents are public records hosted by FERC.

---

## Notes & limitations

- **Sorting:** FERC's API currently errors on explicit `sortBy` values, so lists
  use FERC's default ordering (effectively recency) and the app sorts each page
  client-side by filed date.
- **Restricted documents:** some filings have no downloadable files (privileged
  / CEII). Those show an "open at FERC" link instead.
- **Rate limits:** be polite. The bulk script sleeps between files; the in-browser
  ZIP warns before fetching large batches.
