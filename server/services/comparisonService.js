// Two kinds of comparison, built differently on purpose:
//
// VENDOR (A vs B): different companies word things differently
//   ("Limitation of Liability" vs "Liability Limits"), so text diff is useless.
//   We align by MEANING: Phase 3 analysis already classified each contract's
//   clauses into the same 11 types. Clause types are paired by key, and Gemini
//   compares the actual clause text for each pair.
//
// VERSION (2025 vs 2026): same document, edited. A deterministic text diff
//   (clauseDiffService) finds exactly what was added/removed/changed.
//   Gemini is only asked to EXPLAIN those detected changes, never to find them.
import Chunk from '../models/Chunk.js';
import { CLAUSE_TYPES } from './analysisService.js';
import { runAnalysis } from './contractService.js';
import { diffVersions } from './clauseDiffService.js';
import { generateJson } from './geminiService.js';
import { CHAT_MODEL } from '../config/gemini.js';

const meta = (c) => ({ _id: c._id, title: c.title, vendor: c.vendor, version: c.version });
const label = (c) => `${c.vendor} ${c.version}`;
const loadChunks = (contract) =>
  Chunk.find({ contractId: contract._id }).select('-embedding').sort({ chunkIndex: 1 }).lean();

// ======================= VENDOR COMPARISON =======================

const VENDOR_SYSTEM = `You compare the same type of clause across two contracts.
- The wording may differ; compare what the clauses MEAN and their concrete terms.
- Use only the clause text given. Do not assume anything that is not written.
- aValue / bValue: the key terms in at most 15 words, keeping exact numbers, periods and amounts.
- same = true only if the terms are substantively equivalent.
- difference: one neutral sentence describing how they differ (or "Equivalent terms.").
- Do not say which is better, riskier or more favourable. No legal advice.`;

const vendorSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three neutral sentences on the main differences.' },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: CLAUSE_TYPES.map((c) => c.key) },
          aValue: { type: 'string' },
          bValue: { type: 'string' },
          same: { type: 'boolean' },
          difference: { type: 'string' },
        },
        required: ['key', 'aValue', 'bValue', 'same', 'difference'],
      },
    },
  },
  required: ['summary', 'rows'],
};

// The side of a row the UI needs: what was found and where
const side = (clause) => ({
  found: clause.found,
  summary: clause.summary,
  keyValues: clause.keyValues,
  citations: clause.citations,
});

export async function compareVendors(a, b) {
  // Alignment needs both analyses; run them if missing (cached on the contract after that)
  for (const c of [a, b]) if (!c.analysis) await runAnalysis(c);
  const [chunksA, chunksB] = await Promise.all([loadChunks(a), loadChunks(b)]);

  const clauseText = (chunks, clause) =>
    clause.chunkIds.map((i) => chunks.find((c) => c.chunkIndex === i)?.text).filter(Boolean).join('\n');

  // Step 1: pair clause types. Decide what we can WITHOUT the model.
  const rows = CLAUSE_TYPES.map(({ key, label: clauseLabel }) => {
    const ca = a.analysis.clauses[key];
    const cb = b.analysis.clauses[key];
    const status = ca.found && cb.found ? 'compare' : ca.found ? 'onlyA' : cb.found ? 'onlyB' : 'neither';
    return { key, label: clauseLabel, status, a: side(ca), b: side(cb), textA: clauseText(chunksA, ca), textB: clauseText(chunksB, cb) };
  });

  // Step 2: only clause types present in BOTH go to Gemini
  const toCompare = rows.filter((r) => r.status === 'compare');
  let summary = '';
  if (toCompare.length) {
    const prompt =
      `Contract A = ${label(a)} ("${a.title}")\nContract B = ${label(b)} ("${b.title}")\n\n` +
      toCompare.map((r) => `### ${r.key} (${r.label})\n[A]\n${r.textA}\n\n[B]\n${r.textB}`).join('\n\n');
    const result = await generateJson({ system: VENDOR_SYSTEM, prompt, schema: vendorSchema });
    summary = result.summary;
    const byKey = new Map(result.rows.map((r) => [r.key, r]));

    for (const row of toCompare) {
      const r = byKey.get(row.key);
      if (!r) {
        row.status = 'unknown'; // model skipped it; show both sides without a verdict
        continue;
      }
      Object.assign(row, { status: r.same ? 'same' : 'different', aValue: r.aValue, bValue: r.bValue, difference: r.difference });
    }
  }

  // Step 3: rows the model never saw get plain, deterministic text
  for (const row of rows) {
    if (row.status === 'onlyA') Object.assign(row, { aValue: row.a.summary, bValue: 'Not found', difference: `Only ${label(a)} has this clause.` });
    if (row.status === 'onlyB') Object.assign(row, { aValue: 'Not found', bValue: row.b.summary, difference: `Only ${label(b)} has this clause.` });
    if (row.status === 'neither') Object.assign(row, { aValue: 'Not found', bValue: 'Not found', difference: 'Neither contract has this clause.' });
    if (row.status === 'unknown') Object.assign(row, { aValue: row.a.summary, bValue: row.b.summary, difference: '' });
    delete row.textA;
    delete row.textB;
  }

  return { type: 'vendor', contractA: meta(a), contractB: meta(b), summary, rows, model: toCompare.length ? CHAT_MODEL : null };
}

// ======================= VERSION COMPARISON =======================

const VERSION_SYSTEM = `You explain changes between two versions of a contract.
The changes were already detected by a text diff; do not look for other changes.
- For each change id, write one or two neutral sentences on what changed, using exact values.
- Do not say whether a change is good or bad for either party. No legal advice.`;

const versionSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences on the most significant changes.' },
    explanations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, explanation: { type: 'string' } },
        required: ['id', 'explanation'],
      },
    },
  },
  required: ['summary', 'explanations'],
};

const clip = (text = '', max = 1500) => (text.length > max ? text.slice(0, max) + ' …' : text);

export async function compareVersions(oldContract, newContract, { explain = true } = {}) {
  const [oldChunks, newChunks] = await Promise.all([loadChunks(oldContract), loadChunks(newContract)]);

  // Step 1: deterministic detection (no AI)
  const diff = diffVersions(oldChunks, newChunks);

  // Step 2 (optional): Gemini explains the detected changes, nothing more
  let summary = '';
  let model = null;
  const changed = diff.changes.filter((c) => c.status !== 'unchanged');
  if (explain && changed.length) {
    const prompt =
      `Old version: ${label(oldContract)}. New version: ${label(newContract)}.\n\n` +
      changed
        .map((c) => {
          const values = c.valueChanges.map((v) => `${v.from ?? '(none)'} → ${v.to ?? '(none)'}`).join('; ');
          return [
            `### ${c.id} — ${c.status.toUpperCase()} — ${c.title}`,
            values && `Detected value changes: ${values}`,
            c.oldText && `OLD: ${clip(c.oldText)}`,
            c.newText && `NEW: ${clip(c.newText)}`,
          ].filter(Boolean).join('\n');
        })
        .join('\n\n');

    const result = await generateJson({ system: VERSION_SYSTEM, prompt, schema: versionSchema });
    summary = result.summary;
    model = CHAT_MODEL;
    const byId = new Map(result.explanations.map((e) => [e.id, e.explanation]));
    for (const c of changed) c.explanation = byId.get(c.id) ?? null; // ignore ids we didn't send
  }

  return {
    type: 'version',
    oldContract: meta(oldContract),
    newContract: meta(newContract),
    warning:
      oldContract.vendor !== newContract.vendor
        ? 'These are different vendors. Version comparison pairs clauses by title and wording, so use Vendor comparison instead.'
        : undefined,
    ...diff,
    summary,
    model,
  };
}
