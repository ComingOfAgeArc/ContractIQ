// PDF export (jsPDF + jspdf-autotable), built in the browser from data the page already has.
// The libraries are loaded on demand (dynamic import), so they are not part of the
// main bundle: the app loads exactly as fast as before until someone clicks "PDF".
//
// Each build*Pdf() returns a jsPDF document (easy to test); each export*Pdf() saves it.
import { citationText, keyValueText, pageRange, sectionLabel, slug, valueChangeText, vendorStatusLabel } from './exportCsv.js';

// jsPDF's built-in fonts only cover Western European text (Latin-1 + a few symbols).
// Swap common symbols for plain equivalents and drop the rest, so a stray character
// never turns into garbage in the file. Non-Latin scripts (e.g. Chinese) are not supported.
const SYMBOLS = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': '[ok]', '⚠': '[!]', '‑': '-', '−': '-', '\u2009': ' ', '\u202f': ' ' };
export function pdfSafe(value) {
  return String(value ?? '')
    .replace(/[→←≥≤✓⚠‑−\u2009\u202f]/g, (ch) => SYMBOLS[ch])
    .replace(/[^\t\n\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/g, '');
}

const INK = [15, 23, 42];   // slate-900, like the app's buttons
const MUTED = [100, 116, 139];
const MARGIN = 14;

async function createDoc({ title, subtitle, landscape = false }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const width = pageW - MARGIN * 2;
  let y = MARGIN + 4;

  const ensure = (h) => {
    if (y + h > pageH - 16) {
      doc.addPage();
      y = MARGIN + 4;
    }
  };

  const w = {
    doc,
    get y() { return y; },
    heading(text) {
      ensure(12);
      y += 3;
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK);
      doc.text(pdfSafe(text), MARGIN, y);
      y += 5;
    },
    para(text, { size = 9.5, color = INK, bold = false } = {}) {
      if (!text) return;
      doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(...color);
      const lines = doc.splitTextToSize(pdfSafe(text), width);
      const lineH = size * 0.42;
      for (const line of lines) {
        ensure(lineH + 1);
        doc.text(line, MARGIN, y);
        y += lineH;
      }
      y += 2;
    },
    bullets(items) {
      for (const item of items.filter(Boolean)) w.para(`- ${item}`);
    },
    table({ head, body, columnStyles, fontSize = 8.5 }) {
      if (!body.length) return;
      autoTable(doc, {
        startY: y,
        head: [head.map(pdfSafe)],
        body: body.map((r) => r.map(pdfSafe)),
        margin: { left: MARGIN, right: MARGIN, bottom: 16 },
        styles: { font: 'helvetica', fontSize, cellPadding: 2, overflow: 'linebreak', textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1 },
        headStyles: { fillColor: INK, textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles,
      });
      y = doc.lastAutoTable.finalY + 4;
    },
  };

  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...INK);
  doc.text(pdfSafe(title), MARGIN, y);
  y += 6;
  if (subtitle) w.para(subtitle, { size: 9, color: MUTED });

  // Footer on every page, written last so "Page 2 of 3" is right
  w.finish = () => {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
      doc.text('ContractIQ. Informational only, not legal advice.', MARGIN, pageH - 8);
      doc.text(`Page ${i} of ${total}`, pageW - MARGIN, pageH - 8, { align: 'right' });
    }
    return doc;
  };
  return w;
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------- one contract: summary + parties + flags + clauses ----------------
export async function buildAnalysisPdf(contract) {
  const a = contract.analysis;
  const w = await createDoc({
    title: contract.title,
    subtitle: `${contract.vendor} · ${contract.version} · ${contract.pageCount} pages · exported ${today()}`,
  });

  const s = contract.executiveSummary;
  if (s) {
    w.heading('Executive summary');
    w.para(s.overview);
    if (s.keyTerms?.length) w.table({ head: ['Key term', 'Value'], body: s.keyTerms.map((k) => [k.label, k.value]), columnStyles: { 0: { cellWidth: 55 } } });
    if (s.worthReading?.length) {
      w.para('Worth reading closely', { bold: true });
      w.bullets(s.worthReading);
    }
    if (s.notFound?.length) w.para(`Not found in the contract: ${s.notFound.join(', ')}`, { color: MUTED, size: 9 });
    w.para(`Written by ${s.model} from the extracted clauses and flags below.`, { size: 8, color: MUTED });
  }

  w.heading('Overview');
  w.para(a.summary);
  w.table({
    head: ['Item', 'Value'],
    body: [
      ['Parties', (a.parties ?? []).map((p) => `${p.name} (${p.role})`).join('; ') || '-'],
      ['Effective date', a.effectiveDate || '-'],
      ['End date', a.endDate || 'Not stated'],
    ],
    columnStyles: { 0: { cellWidth: 40 } },
  });

  if (contract.flags?.length) {
    w.heading('Flags');
    w.para('Rule-based and informational: terms worth reading, not risk ratings.', { size: 8.5, color: MUTED });
    w.table({
      head: ['Flag', 'Value', 'Detail', 'Source'],
      body: contract.flags.map((f) => [f.title, f.value ?? '', f.detail ?? '', citationText(f.citations)]),
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 28 }, 3: { cellWidth: 30 } },
    });
  }

  w.heading('Clauses');
  w.table({
    head: ['Clause', 'What the contract says', 'Source'],
    body: Object.values(a.clauses).map((c) => [
      c.label,
      c.found ? [c.summary, keyValueText(c.keyValues)].filter(Boolean).join('\n') : 'Not found in this contract',
      c.found ? citationText(c.citations) : '',
    ]),
    columnStyles: { 0: { cellWidth: 38 }, 2: { cellWidth: 32 } },
  });
  w.para(`Extracted by ${a.model} on ${new Date(a.analyzedAt).toLocaleDateString()}. Quotes are verified against the contract text in the app.`, { size: 8, color: MUTED });
  return w.finish();
}

// ---------------- vendor A vs B ----------------
export async function buildVendorPdf(result) {
  const { contractA: A, contractB: B } = result;
  const nameA = `${A.vendor} ${A.version}`;
  const nameB = `${B.vendor} ${B.version}`;
  const w = await createDoc({ title: `${nameA} vs ${nameB}`, subtitle: `Vendor comparison · exported ${today()}`, landscape: true });

  if (result.summary) w.para(result.summary);
  const differing = result.rows.filter((r) => r.status !== 'same' && r.status !== 'neither').length;
  w.para(`${differing} of ${result.rows.length} clause types differ. Clauses are matched by type, not wording.`, { size: 8.5, color: MUTED });

  const cell = (value, citations) => [value, citationText(citations)].filter(Boolean).join('\n');
  w.table({
    head: ['Clause', 'Status', `A: ${nameA}`, `B: ${nameB}`, 'Difference'],
    body: result.rows.map((r) => [r.label, vendorStatusLabel(r.status), cell(r.aValue, r.a?.citations), cell(r.bValue, r.b?.citations), r.difference ?? '']),
    columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 20 } },
  });
  return w.finish();
}

// ---------------- old vs new version ----------------
// "§ 2" if the section did not move, "§ 11 -> § 12" if it was renumbered
const sectionText = (c) => {
  const [o, n] = [sectionLabel(c.oldSection), sectionLabel(c.newSection)];
  return o && n && o !== n ? `${o} -> ${n}` : n || o;
};
const clip = (text, n = 350) => (text && text.length > n ? `${text.slice(0, n).trim()}...` : text ?? '');

export async function buildVersionPdf(result) {
  const { oldContract: O, newContract: N, counts } = result;
  const w = await createDoc({
    title: `${O.vendor}: ${O.version} -> ${N.version}`,
    subtitle: `Version comparison · exported ${today()}`,
  });

  if (result.warning) w.para(result.warning, { color: MUTED });
  if (result.summary) w.para(result.summary);
  w.para(`${counts.added} added · ${counts.removed} removed · ${counts.modified} modified · ${counts.unchanged} unchanged. Changes were found by text diff (no AI).`, { size: 8.5, color: MUTED });

  const changed = result.changes.filter((c) => c.status !== 'unchanged');
  w.table({
    head: ['Status', 'Clause', 'Value changes', 'Details'],
    body: changed.map((c) => [
      c.status,
      `${c.title}\n${sectionText(c)} ${pageRange(c.newPages ?? c.oldPages ?? [])}`.trim(),
      valueChangeText(c.valueChanges),
      c.explanation || clip(c.status === 'removed' ? c.oldText : c.newText),
    ]),
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 40 }, 2: { cellWidth: 36 } },
  });
  if (!changed.length) w.para('No differences found.');

  const unchanged = result.changes.filter((c) => c.status === 'unchanged').map((c) => c.title);
  if (unchanged.length) w.para(`Unchanged: ${unchanged.join(', ')}`, { size: 8.5, color: MUTED });
  return w.finish();
}

// ---------------- save (browser) ----------------
export async function exportAnalysisPdf(contract) {
  (await buildAnalysisPdf(contract)).save(`contractiq-${slug(contract.vendor, contract.version, 'overview')}.pdf`);
}
export async function exportVendorPdf(result) {
  const { contractA: A, contractB: B } = result;
  (await buildVendorPdf(result)).save(`contractiq-${slug(A.vendor, A.version, 'vs', B.vendor, B.version)}.pdf`);
}
export async function exportVersionPdf(result) {
  const { oldContract: O, newContract: N } = result;
  (await buildVersionPdf(result)).save(`contractiq-${slug(O.vendor, O.version, 'to', N.version)}-changes.pdf`);
}
