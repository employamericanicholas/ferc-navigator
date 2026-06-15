// Small shared helpers: formatting, dates, downloads, DOM, exports.

const Util = {
  // ---- formatting -----------------------------------------------------------
  bytes(n) {
    if (!n) return "—";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
  },

  esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  },

  // Highlight a query term within text (after escaping).
  highlight(text, term) {
    const safe = this.esc(text);
    if (!term) return safe;
    const t = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!t) return safe;
    try {
      return safe.replace(new RegExp(`(${t})`, "gi"), "<mark>$1</mark>");
    } catch {
      return safe;
    }
  },

  // ---- dates ----------------------------------------------------------------
  // FERC date strings look like "06/15/2026"; return them as-is or "—".
  date(s) {
    return s && s.trim() ? s : "—";
  },

  // For default date windows: "MM/DD/YYYY" for a Date.
  fmtDate(d) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mm}/${dd}/${d.getFullYear()}`;
  },

  daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  },

  // Parse FERC "MM/DD/YYYY" into a comparable timestamp (0 if unparseable).
  ts(s) {
    if (!s) return 0;
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (!m) return 0;
    return new Date(+m[3], +m[1] - 1, +m[2]).getTime();
  },

  // ---- docket numbers -------------------------------------------------------
  // Strip the sub-docket suffix: "ER26-1800-001" -> "ER26-1800".
  baseDocket(d) {
    const m = /^([A-Za-z]+\d+-\d+)/.exec(d || "");
    return m ? m[1] : d || "";
  },

  // ---- downloads ------------------------------------------------------------
  saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  saveText(text, filename, mime = "text/plain") {
    this.saveBlob(new Blob([text], { type: mime }), filename);
  },

  // ---- CSV ------------------------------------------------------------------
  csvCell(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  },

  filingsToCsv(filings) {
    const head = [
      "accession", "filed_date", "issued_date", "posted_date",
      "dockets", "category", "class_types", "libraries",
      "availability", "description", "num_files", "file_names", "file_ids",
    ];
    const rows = filings.map((f) => [
      f.accession, f.filedDate, f.issuedDate, f.postedDate,
      f.dockets.join("; "), f.category, f.classTypes.join("; "),
      f.libraries.join("; "), f.availCode, f.description,
      f.files.length, f.files.map((x) => x.name).join(" | "),
      f.files.map((x) => x.fileId).join(" | "),
    ].map((c) => this.csvCell(c)).join(","));
    return [head.join(","), ...rows].join("\n");
  },

  // ---- DOM ------------------------------------------------------------------
  el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        e.addEventListener(k.slice(2), v);
      } else if (v !== null && v !== undefined) {
        e.setAttribute(k, v);
      }
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  },
};

window.Util = Util;
