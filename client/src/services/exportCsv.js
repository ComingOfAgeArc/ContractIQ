// CSV export. Everything is built in the browser from data the page already has,
// so exporting needs no new API calls and touches nothing on the server.
//
// Each builder returns an array of rows (first row = header). toCsv() turns rows into text.

import { clauseVerification } from './verificationView.js';

// One cell → CSV text.
//  - quotes/commas/newlines are escaped the standard way (RFC 4180)
//  - a cell starting with = + - @ would be run as a formula by Excel/Sheets
//    ("CSV injection"), and contract text is untrusted, so we prefix it with '
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

// Trigger a file download. The BOM (\uFEFF) makes Excel read the file as UTF-8,
// so €, ü and § show correctly.
export function downloadFile(filename, text, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (...parts) =>
  parts
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ---------- small formatters (shared with the PDF export) ----------
export const pageRange = ([a, b]) => (a == null ? '' : a === b ? `p. ${a}` : `pp. ${a}-${b}`);
export const sectionLabel = (n) => (n ? `§ ${n}` : '');

export function citationText(citations = []) {
  return citations
    .map((c) => `${c.sectionNumber ? `§ ${c.sectionNumber}` : c.sectionTitle ?? ''} ${pageRange([c.pageStart, c.pageEnd])}`.trim())
    .join('; ');
}

// Same wording as the Compare page
const VENDOR_STATUS = { same: 'Same', different: 'Different', onlyA: 'Only A', onlyB: 'Only B', neither: 'Neither', unknown: 'Unknown' };
export const vendorStatusLabel = (s) => VENDOR_STATUS[s] ?? s;

export const keyValueText = (kvs = []) => kvs.map((kv) => `${kv.label}: ${kv.value}`).join('; ');
export const valueChangeText = (changes = []) => changes.map((v) => `${v.from ?? '(none)'} -> ${v.to ?? '(none)'}`).join('; ');

// ---------- builders ----------

const EVIDENCE_LABELS = { verified: 'Quote verified', unverified: 'Unverified - check source', not_found: '' };

// One contract: a row per clause type + a row per flag
export function analysisRows(contract) {
  const a = contract.analysis;
  const base = [contract.title, contract.vendor, contract.version];
  const rows = [['Contract', 'Vendor', 'Version', 'Kind', 'Item', 'Found / flag type', 'Key values', 'Summary / detail', 'Quote', 'Evidence', 'Source']];

  for (const c of Object.values(a?.clauses ?? {})) {
    rows.push([
      ...base, 'Clause', c.label, c.found ? 'Yes' : 'No', keyValueText(c.keyValues), c.summary,
      c.quote, EVIDENCE_LABELS[clauseVerification(c)], citationText(c.citations),
    ]);
  }
  for (const f of contract.flags ?? []) {
    rows.push([...base, 'Flag', f.title, f.type, f.value, f.detail, f.evidence, '', citationText(f.citations)]);
  }
  return rows;
}

// Vendor A vs B: one row per clause type
export function vendorRows(result) {
  const { contractA: A, contractB: B } = result;
  const nameA = `${A.vendor} ${A.version}`;
  const nameB = `${B.vendor} ${B.version}`;
  return [
    ['Clause', 'Status', nameA, nameB, 'Difference', `${nameA} source`, `${nameB} source`],
    ...result.rows.map((r) => [r.label, vendorStatusLabel(r.status), r.aValue, r.bValue, r.difference, citationText(r.a?.citations), citationText(r.b?.citations)]),
  ];
}

// Old vs new version: one row per clause (unchanged ones included, so the file is a full record)
export function versionRows(result) {
  return [
    ['Status', 'Clause', 'Old section', 'New section', 'Value changes', 'Explanation', 'Old text', 'New text'],
    ...result.changes.map((c) => [
      c.status, c.title, sectionLabel(c.oldSection), sectionLabel(c.newSection),
      valueChangeText(c.valueChanges), c.explanation, c.status === 'unchanged' ? '' : c.oldText, c.status === 'unchanged' ? '' : c.newText,
    ]),
  ];
}

// Flags page: a row per flag, a column per analysed contract
export function flagsMatrixRows(contracts) {
  const analysed = contracts.filter((c) => c.status === 'analyzed');
  const all = new Map();
  for (const c of analysed) for (const f of c.flags ?? []) all.set(f.code, f);
  const flags = [...all.values()].sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));

  return [
    ['Flag', 'Type', ...analysed.map((c) => `${c.vendor} ${c.version}`)],
    ...flags.map((flag) => [
      flag.title, flag.type,
      ...analysed.map((c) => {
        const hit = (c.flags ?? []).find((f) => f.code === flag.code);
        return hit ? (hit.value ?? 'Yes') : '';
      }),
    ]),
  ];
}
