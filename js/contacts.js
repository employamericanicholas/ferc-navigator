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
};

window.Contacts = Contacts;
