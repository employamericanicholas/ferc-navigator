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
| `js/script-template.js` | Generates the per-docket downloader script |
| `scripts/download_docket.py` | Standalone bulk archiver |

### The FERC API (reverse-engineered)
Base: `https://elibrary.ferc.gov/eLibrarywebapi/api`

- `POST Search/AdvancedSearch` — keyword/full-text search with docket, date, and
  library filters. Set `searchFullText: true` to search inside PDF text.
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
