// Contract overview: extract parties, dates and key clause types as structured JSON.
//
// Why NOT RAG here? Q&A needs the few most relevant chunks. Extraction needs
// completeness: a search might skip the one chunk that holds the renewal rule.
// Contracts are small next to Gemini's context window, so we send ALL chunks,
// each labelled [C0], [C1]… and ask the model which chunks support each answer.
//
// Anti-hallucination: every clause must include a short verbatim quote. We check
// that the quote really exists in the contract. Each clause then carries
//   verification: 'verified'   – the quote was found in the contract text
//                 'unverified' – reported as found, but the evidence could not be confirmed
//                 'not_found'  – the model says the contract has no such clause
// plus a plain-English verificationNote saying why. Unverified clauses are KEPT
// (they may still be useful) but the UI labels them clearly.
import Chunk from '../models/Chunk.js';
import { unsupportedNumbers } from './groundingService.js';
import { generateJson } from './geminiService.js';
import { CHAT_MODEL } from '../config/gemini.js';

const MAX_CONTRACT_CHARS = 300_000; // ≈ 75k tokens; bigger contracts need a smarter approach

export const CLAUSE_TYPES = [
  { key: 'term', label: 'Term', hint: 'initial duration, start and end' },
  { key: 'renewal', label: 'Renewal', hint: 'automatic or manual renewal, renewal period, non-renewal notice' },
  { key: 'termination', label: 'Termination', hint: 'for convenience, for cause, notice periods, cure periods, effects' },
  { key: 'payment', label: 'Payment', hint: 'fees, currency, invoicing, payment days, late interest, price increases' },
  { key: 'liability', label: 'Limitation of liability', hint: 'caps, exclusions, carve-outs' },
  { key: 'indemnification', label: 'Indemnification', hint: 'who indemnifies whom, for what' },
  { key: 'confidentiality', label: 'Confidentiality', hint: 'obligations, duration' },
  { key: 'dataProtection', label: 'Data protection', hint: 'processing, breach notification time, data location, security' },
  { key: 'sla', label: 'Service levels (SLA)', hint: 'uptime %, service credits, remedies' },
  { key: 'ip', label: 'Intellectual property', hint: 'ownership, licences' },
  { key: 'governingLaw', label: 'Governing law', hint: 'law and courts/jurisdiction' },
];

// JSON Schema for Gemini's structured output. The model can only return this shape.
const clauseSchema = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'false if the contract has no such clause' },
    summary: { type: 'string', description: 'One or two plain sentences. Empty if not found.' },
    keyValues: {
      type: 'array',
      description: 'Concrete terms, e.g. {label:"Notice period", value:"90 days"}',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'string' } },
        required: ['label', 'value'],
      },
    },
    chunkIds: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the [C#] chunks used' },
    quote: { type: 'string', description: 'Short exact quote (max ~25 words) copied from a cited chunk. Empty if not found.' },
  },
  required: ['found', 'summary', 'keyValues', 'chunkIds', 'quote'],
};

const analysisSchema = {
  type: 'object',
  properties: {
    parties: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, role: { type: 'string', description: 'e.g. Supplier, Customer' } },
        required: ['name', 'role'],
      },
    },
    effectiveDate: { type: 'string', description: 'As YYYY-MM-DD if stated, else empty string' },
    endDate: { type: 'string', description: 'As YYYY-MM-DD only if explicitly stated, else empty string' },
    summary: { type: 'string', description: 'Two sentences: what this contract is for.' },
    clauses: {
      type: 'object',
      properties: Object.fromEntries(CLAUSE_TYPES.map((c) => [c.key, clauseSchema])),
      required: CLAUSE_TYPES.map((c) => c.key),
    },
  },
  required: ['parties', 'effectiveDate', 'endDate', 'summary', 'clauses'],
};

const SYSTEM_PROMPT = `You extract information from a contract. Use ONLY the text of the numbered chunks.
- Never guess. If something is not stated, set found=false and leave text fields empty.
- Keep numbers, periods, amounts and percentages exactly as written.
- chunkIds must list the [C#] numbers where you found the information.
- quote must be copied character-for-character from one of those chunks.
- Describe what the contract says; do not give legal advice or risk opinions.`;

// For comparing quotes: ignore case, spacing, line breaks and curly vs straight quotes
const normalize = (s) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
// Looser: also ignore all punctuation ("(a) the Supplier's" ≈ "a the Suppliers")
const loose = (s) => normalize(s).replace(/['"]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const MIN_WORDS_ANYWHERE = 3; // shorter quotes ("30 days") only count inside the cited chunks

// Do all parts appear in this order? (models shorten quotes with "…")
function containsInOrder(haystack, parts) {
  let from = 0;
  for (const part of parts) {
    const at = haystack.indexOf(part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

// Find the chunk that contains the quote. Cited chunks are checked first.
// Returns { chunk, loose } or null.
export function findQuote(quote, chunks, preferredIds = []) {
  const split = (text, fn) => fn(text).split(/\s*(?:\.\.\.|…)\s*/).map((p) => p.trim()).filter((p) => p.length >= 3);
  const preferred = new Set(preferredIds);
  const ordered = [...chunks.filter((c) => preferred.has(c.chunkIndex)), ...chunks.filter((c) => !preferred.has(c.chunkIndex))];
  const shortQuote = quote.trim().split(/\s+/).length < MIN_WORDS_ANYWHERE;

  for (const [fn, isLoose] of [[normalize, false], [loose, true]]) {
    const parts = split(quote, fn);
    if (!parts.length) continue;
    const chunk = ordered.find((c) => (!shortQuote || preferred.has(c.chunkIndex)) && containsInOrder(fn(c.text), parts));
    if (chunk) return { chunk, loose: isLoose };
  }
  return null;
}

// Numbers in a key value ("90 days", "EUR 120,000") must appear in the cited text.
// 'ok' | 'not_in_text' | null (nothing checkable, e.g. "Laws of England")
function checkValue(value, evidence) {
  if (!/\d/.test(value ?? '')) return null;
  return unsupportedNumbers(value, [evidence]).length ? 'not_in_text' : 'ok';
}

export function verifyAndCite(clause, chunks) {
  const byIndex = new Map(chunks.map((c) => [c.chunkIndex, c]));
  const requested = Array.isArray(clause.chunkIds) ? clause.chunkIds : [];
  const chunkIds = requested.filter((i) => byIndex.has(i)); // drop ids that don't exist…
  const invalidChunkIds = requested.filter((i) => !byIndex.has(i)); // …but record them

  let verified = false;
  let verification;
  let verificationNote = null;
  if (!clause.found) {
    verification = 'not_found';
  } else if (!clause.quote?.trim()) {
    verification = 'unverified';
    verificationNote = 'No supporting quote was returned, so this could not be checked against the contract text.';
  } else {
    const match = findQuote(clause.quote, chunks, chunkIds);
    if (match) {
      verified = true;
      verification = 'verified';
      if (!chunkIds.includes(match.chunk.chunkIndex)) chunkIds.push(match.chunk.chunkIndex);
      if (match.loose) verificationNote = 'Quote matched the contract text when punctuation is ignored.';
    } else {
      verification = 'unverified';
      verificationNote = 'The quoted text was not found in the contract, so this could not be confirmed. Read the cited section before relying on it.';
    }
  }
  if (clause.found && !chunkIds.length) {
    verificationNote = `${verificationNote ?? ''} No valid source section was cited.`.trim();
  }

  const evidence = chunkIds.map((i) => byIndex.get(i).text).join('\n');
  const keyValues = (clause.keyValues ?? []).map((kv) => ({ ...kv, check: clause.found ? checkValue(kv.value, evidence) : null }));

  const citations = chunkIds.map((i) => {
    const c = byIndex.get(i);
    return {
      chunkIndex: i,
      sectionNumber: c.sectionNumber,
      sectionTitle: c.sectionTitle,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
    };
  });

  return { ...clause, keyValues, chunkIds, invalidChunkIds, verified, verification, verificationNote, citations };
}

export async function analyzeContract(contract) {
  const chunks = await Chunk.find({ contractId: contract._id }).select('-embedding').sort({ chunkIndex: 1 }).lean();
  if (!chunks.length) throw new Error('Contract has no chunks yet. Process it first.');

  const fullText = chunks.map((c) => `[C${c.chunkIndex}] (page ${c.pageStart})\n${c.text}`).join('\n\n');
  if (fullText.length > MAX_CONTRACT_CHARS) {
    throw new Error(`Contract too long to analyse in one pass (${fullText.length} chars).`);
  }

  const clauseList = CLAUSE_TYPES.map((c) => `- ${c.key}: ${c.label} (${c.hint})`).join('\n');
  const prompt = `Extract the parties, dates, a short summary, and these clause types:\n${clauseList}\n\nContract "${contract.title}":\n\n${fullText}`;

  const raw = await generateJson({ system: SYSTEM_PROMPT, prompt, schema: analysisSchema });

  const clauses = {};
  for (const { key, label } of CLAUSE_TYPES) {
    const clause = raw.clauses?.[key] ?? { found: false, summary: '', keyValues: [], chunkIds: [], quote: '' };
    clauses[key] = { label, ...verifyAndCite(clause, chunks) };
  }

  return {
    parties: raw.parties ?? [],
    effectiveDate: raw.effectiveDate || null,
    endDate: raw.endDate || null,
    summary: raw.summary ?? '',
    clauses,
    model: CHAT_MODEL,
    analyzedAt: new Date(),
  };
}
