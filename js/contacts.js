// Contact extraction from filing PDFs.
//
// FERC's API exposes no email/phone. But e-filed PDFs carry a text layer with a
// signature block ("Respectfully submitted, … name, title, employer, phone,
// email"). This module lazy-loads pdf.js, pulls the text, and parses contacts.
//
// Limitation: older image-only scans have no text layer — extraction yields
// nothing, and we say so. Verified working on real FERC transmittal letters.

const Contacts = {
  PDFJS_VER: "3.11.174",
  _loading: null,

  // Lazy-load pdf.js (UMD, exposes window.pdfjsLib) only on first use.
  loadPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (this._loading) return this._loading;
    const base = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${this.PDFJS_VER}/build`;
    this._loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${base}/pdf.min.js`;
      s.onload = () => {
        if (!window.pdfjsLib) return reject(new Error("pdf.js failed to initialize"));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.js`;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error("Could not load pdf.js (offline?)"));
      document.head.appendChild(s);
    });
    return this._loading;
  },

  // Extract concatenated text from up to `maxPages` pages of a PDF blob.
  async extractText(blob, maxPages = 8) {
    const pdfjs = await this.loadPdfjs();
    const data = new Uint8Array(await blob.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    let text = "";
    const n = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return { text, numPages: doc.numPages };
  },

  EMAIL: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  PHONE: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  SIG: /(Respectfully submitted|Sincerely|Very truly yours|\/s\/|Counsel for|On behalf of)[\s\S]{0,400}/gi,

  // Parse contacts out of extracted text.
  parse(text) {
    const clean = text.replace(/[ \t]+/g, " ");
    const emails = [...new Set((clean.match(this.EMAIL) || [])
      .map((e) => e.replace(/[.,;)]+$/, "").toLowerCase()))];
    const phones = [...new Set((clean.match(this.PHONE) || [])
      .filter((p) => p.replace(/\D/g, "").length === 10 || p.replace(/\D/g, "").length === 11))];

    const sigs = [];
    let m;
    const re = new RegExp(this.SIG.source, "gi");
    while ((m = re.exec(text)) !== null && sigs.length < 4) {
      sigs.push(m[0].replace(/\s+/g, " ").trim().slice(0, 320));
    }
    return { emails, phones, signatures: sigs, hasText: clean.trim().length > 30 };
  },

  // Full pipeline for one file blob.
  async fromBlob(blob) {
    const { text, numPages } = await this.extractText(blob);
    return { ...this.parse(text), numPages };
  },

  // ---- structured extraction (Name / Title / Phone / Email / Address) -------
  // pdf.js flattens text; reconstruct LINES from per-item y-positions + EOL so
  // we can parse signature blocks field-by-field.
  async extractLines(blob, maxPages = 8) {
    const pdfjs = await this.loadPdfjs();
    const data = new Uint8Array(await blob.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    const lines = [];
    const n = Math.min(doc.numPages, maxPages);
    for (let p = 1; p <= n; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      let cur = [], lastY = null;
      const flush = () => { const s = cur.join("").replace(/\s+/g, " ").trim(); if (s) lines.push(s); cur = []; };
      for (const it of tc.items) {
        const y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 3) flush();
        cur.push(it.str);
        if (it.hasEOL) { flush(); lastY = null; } else lastY = y;
      }
      flush();
    }
    return lines;
  },

  TITLE_RE: /(President|Vice President|Counsel|Attorney|Director|Manager|Secretary|Officer|Regulatory|Affairs|Analyst|Engineer|Specialist|Consultant|Chief|Partner|Associate|Paralegal|Administrator|Executive|Advisor|Representative|Agent)/i,
  ADDR_RE: /(\d+\s+\w+.*(Street|St\.|Avenue|Ave\.|Boulevard|Blvd|Road|Rd\.|Drive|Dr\.|Lane|Ln\.|Suite|Floor|NW|NE|SW|SE|P\.?O\.?\s*Box))|([A-Z][a-zA-Z]+,?\s*[A-Z]{2}\s+\d{5})/,
  ORG_RE: /(L\.?L\.?C|L\.?L\.?P|Inc\.|Corp|Compan(y|ies)|Commission|Energy|Power|Associates|P\.?C\.?|Partners|Group|Authority|Cooperative|Utilities|Electric|Gas)\b/i,

  _looksLikeName(l) {
    if (!l) return false;
    const single = l.match(this.EMAIL) || this.PHONE.test(l);
    if (single || this.TITLE_RE.test(l) || this.ADDR_RE.test(l) || this.ORG_RE.test(l)) return false;
    const words = l.replace(/^\/s\/\s*/i, "").trim().split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;
    return words.every((w) => /^[A-Z][A-Za-z.'’-]*\.?$/.test(w));
  },

  // Parse structured contacts from reconstructed lines. Email-anchored: for each
  // email, look upward for a name + title and nearby for phone + address.
  parseStructured(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const em = lines[i].match(this.EMAIL);
      if (!em) continue;
      const email = em[0].replace(/[.,;)]+$/, "").toLowerCase();
      if (out.some((o) => o.email === email)) continue;

      let phone = "", name = "", title = "", address = "";
      const lo = Math.max(0, i - 6);
      for (let j = lo; j <= i; j++) {
        const pm = lines[j].match(this.PHONE);
        if (pm && pm[0].replace(/\D/g, "").length >= 10) phone = pm[0];
      }
      const addrs = [];
      for (let j = lo; j <= i; j++) if (this.ADDR_RE.test(lines[j])) addrs.push(lines[j]);
      address = [...new Set(addrs)].join(", ");
      for (let j = i; j >= lo; j--) {
        if (this._looksLikeName(lines[j])) {
          name = lines[j].replace(/^\/s\/\s*/i, "").trim();
          for (let k = j + 1; k <= Math.min(lines.length - 1, j + 3); k++) {
            if (this.TITLE_RE.test(lines[k]) && !lines[k].match(this.EMAIL) && !this.PHONE.test(lines[k])) {
              title = lines[k]; break;
            }
          }
          break;
        }
      }
      out.push({ name, title, phone, email, address });
    }
    return out;
  },

  async structuredFromBlob(blob) {
    return this.parseStructured(await this.extractLines(blob));
  },
};

window.Contacts = Contacts;
