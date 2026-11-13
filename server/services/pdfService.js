import crypto from 'node:crypto';
import { PDFParse } from 'pdf-parse';

// Tidy the raw text from a page without destroying its line structure.
// We KEEP line breaks on purpose: Phase 2 uses them to find clause headings
// like "12. Limitation of Liability".
export function cleanText(text) {
  return text
    .replace(/\r\n?/g, '\n')             // Windows/Mac line endings → \n
    .replace(/ /g, ' ')             // non-breaking spaces → normal spaces
    .replace(/(\w)-\n(\w)/g, '$1$2')     // re-join words hyphenated across lines
    .replace(/[ \t]+/g, ' ')             // collapse runs of spaces/tabs
    .split('\n').map((line) => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')          // at most one blank line in a row
    .trim();
}

// Real PDF files start with "%PDF-" (the spec allows up to 1 KB of junk before it).
// Checked because the browser-supplied MIME type and file name are not trustworthy.
export function looksLikePdf(buffer) {
  return Buffer.from(buffer.subarray(0, 1024)).includes('%PDF-');
}

export function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// buffer (PDF bytes) → { pageCount, pages: [{ pageNumber, text }], charCount }
export async function extractPages(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const pages = result.pages.map((p) => ({ pageNumber: p.num, text: cleanText(p.text) }));
    const charCount = pages.reduce((sum, p) => sum + p.text.length, 0);
    return { pageCount: result.total, pages, charCount };
  } finally {
    await parser.destroy(); // free pdf.js memory
  }
}
