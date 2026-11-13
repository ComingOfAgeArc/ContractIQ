// RAG = Retrieval-Augmented Generation, written out step by step:
//   1. retrieve  – find the chunks most relevant to the question (hybrid search),
//                  optionally followed by a rerank step (see rerankService, RERANK=on)
//   2. augment   – put those chunks into the prompt as numbered sources [S1], [S2]…
//   3. generate  – ask Gemini to answer ONLY from those sources and cite them
//   4. verify    – keep only citations that point to sources we actually sent, and
//                  run cheap text checks on every statement (groundingService).
//                  These checks show WHERE to look; they do not prove the answer is right.
import { search, searchPerContract } from './searchService.js';
import { checkStatements } from './groundingService.js';
import { generateText } from './geminiService.js';
import { rerankChunks, RERANK_ENABLED, RERANK_CANDIDATES } from './rerankService.js';
import { CHAT_MODEL } from '../config/gemini.js';

const TOP_K = 8;          // chunks sent to Gemini in total
const MIN_PER_CONTRACT = 3;

export const NOT_FOUND = 'I could not find this in the selected contracts.';

const SYSTEM_PROMPT = `You answer questions about contracts using ONLY the numbered sources provided.

Rules:
- Use only facts stated in the sources. Do not use outside knowledge, typical market terms or assumptions.
- Never invent or estimate contract terms, amounts, dates, periods, percentages, parties or obligations.
  If a value is not written in a source, do not state it.
- After every sentence that states a fact, cite the source(s) that state it, like [S1] or [S2][S4].
  Cite only the IDs listed below (S1, S2, ...). Never cite a source that does not support the sentence.
- If the sources do not contain the answer, reply exactly: "${NOT_FOUND}"
  If they contain only part of it, answer that part (with citations) and say plainly what is not stated.
- Do not calculate, combine or infer new values (no totals, conversions or "therefore" conclusions)
  unless the source itself states the result.
- When several contracts are involved, name the contract (vendor and version) for each fact.
  If the question asks about a contract that is not among the sources, say it is not in the selected contracts.
- Quote exact numbers, periods, amounts and percentages as written.
- Be concise: a few sentences or a short bullet list.
- Plain text only: no markdown headings or bold; use "- " for bullets.
- Describe what the contract says. Do not give legal advice, opinions or risk ratings.`;

// Step 1 — retrieve (hybrid: meaning + exact words, see searchService).
// With several contracts selected, search each one separately, so a long
// contract can't fill all TOP_K slots and hide the others.
// `pool` = how many chunks to fetch (TOP_K normally; more when a reranker will trim them).
export async function retrieve(question, contractIds = [], mode = 'hybrid', { pool = TOP_K } = {}) {
  if (contractIds.length <= 1) {
    return search(question, { mode, contractIds, limit: pool });
  }
  const perContract = Math.max(MIN_PER_CONTRACT, Math.ceil(pool / contractIds.length));
  const groups = await searchPerContract(question, contractIds, { perContract, mode });
  return groups.flatMap((g) => g.results).sort((a, b) => b.score - a.score);
}

function pageLabel(c) {
  return c.pageStart === c.pageEnd ? `page ${c.pageStart}` : `pages ${c.pageStart}-${c.pageEnd}`;
}

// Step 2 — augment: chunks → numbered context block
function buildContext(sources) {
  return sources
    .map(
      (s) =>
        `[${s.id}] Contract: ${s.contractTitle} | Vendor: ${s.vendor} | Version: ${s.version} | ` +
        `Section: ${s.sectionNumber ? s.sectionNumber + '. ' : ''}${s.sectionTitle} | ${pageLabel(s)}\n${s.text}`
    )
    .join('\n\n---\n\n');
}

// Step 4 — verify: which [S#] markers did the answer use, and do they exist?
// Returns the cleaned answer, the cited sources, and the ids that were removed
// because the model made them up (we never sent a source with that id).
export function extractCitations(answer, sources) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const normalized = answer
    // "[s1]" → "[S1]"
    .replace(/\[s(\d+)\]/g, '[S$1]')
    // "[S1, S3]" / "[S1; S3]" / "[S1 and S3]" → "[S1][S3]" so every citation has the same form
    .replace(/\[(S\d+(?:\s*(?:,|;|and)\s*S\d+)+)\]/gi, (_, ids) =>
      ids.split(/\s*(?:,|;|and)\s*/i).map((id) => `[${id.toUpperCase()}]`).join('')
    );
  const usedIds = [...new Set([...normalized.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]))];
  const valid = usedIds.filter((id) => byId.has(id));
  const invalid = usedIds.filter((id) => !byId.has(id));
  // Remove markers pointing at sources that don't exist (a hallucinated citation)
  const cleaned = normalized
    .replace(/\[(S\d+)\]/g, (m, id) => (byId.has(id) ? m : ''))
    .replace(/ +([.,;:])/g, '$1'); // tidy "point ." left behind by a removed marker
  return { answer: cleaned, citations: valid.map((id) => byId.get(id)), invalidCitations: invalid };
}

// Did the model say it could not answer? (exact phrase, maybe with stray markers)
export function isAbstention(answer) {
  const plain = answer.replace(/\[S\d+\]/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return !plain || plain === NOT_FOUND.toLowerCase() || plain === NOT_FOUND.toLowerCase().replace(/\.$/, '');
}

// Defence in depth: retrieval already filters by contract, but never let a chunk
// from an unselected contract reach the prompt (and so never let it be cited).
export function scopeToContracts(chunks, contractIds = []) {
  if (!contractIds.length) return chunks;
  const allowed = new Set(contractIds.map(String));
  return chunks.filter((c) => allowed.has(String(c.contractId)));
}

const MAX_LISTED = 5;

// Summarise the statement checks into one status the UI can show.
//   insufficient_information – nothing relevant retrieved, or the model abstained
//   uncited                  – the answer has no valid citation at all: treat it as unsupported
//   partially_cited          – some statements lack citations, a number is not in its cited text,
//                              or the model cited a source it was never given
//   cited                    – every factual statement cites a real source and its numbers appear there
export function buildVerification({ answer, citations, invalidCitations = [], sources, abstained }) {
  if (!sources.length) {
    return { status: 'insufficient_information', message: 'No relevant contract text was found for this question.', invalidCitations: [], uncitedStatements: [], unverifiedValues: [] };
  }
  if (abstained) {
    return { status: 'insufficient_information', message: 'The selected contracts do not contain enough information to answer this.', invalidCitations, uncitedStatements: [], unverifiedValues: [] };
  }

  const statements = checkStatements(answer, sources);
  const uncitedStatements = statements.filter((s) => s.uncited).map((s) => s.text);
  const unverifiedValues = statements.flatMap((s) => s.unsupportedValues.map((value) => ({ value, statement: s.text })));

  let status = 'cited';
  let message = 'Every factual statement cites a retrieved clause. Open the citations to check them.';
  if (!citations.length) {
    status = 'uncited';
    message = 'This answer has no valid citations, so it is not supported by the contract text shown. Treat it as unverified.';
  } else if (uncitedStatements.length || unverifiedValues.length || invalidCitations.length) {
    status = 'partially_cited';
    const reasons = [];
    if (uncitedStatements.length) reasons.push(`${uncitedStatements.length} statement(s) have no citation`);
    if (unverifiedValues.length) reasons.push(`${unverifiedValues.length} value(s) do not appear in the cited text`);
    if (invalidCitations.length) reasons.push(`${invalidCitations.length} invalid citation(s) were removed`);
    message = `Check carefully: ${reasons.join('; ')}.`;
  }
  return {
    status,
    message,
    invalidCitations,
    uncitedStatements: uncitedStatements.slice(0, MAX_LISTED),
    unverifiedValues: unverifiedValues.slice(0, MAX_LISTED),
  };
}

// Keep only what the UI needs for a citation
function toSource(chunk, i) {
  return {
    id: `S${i + 1}`,
    chunkId: chunk._id,
    chunkIndex: chunk.chunkIndex, // with contractId → link to /contracts/:id?chunk=N
    contractId: chunk.contractId,
    contractTitle: chunk.contractTitle,
    vendor: chunk.vendor,
    version: chunk.version,
    sectionNumber: chunk.sectionNumber,
    sectionTitle: chunk.sectionTitle,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    score: chunk.score,
    ranks: chunk.ranks, // { vector: 2, keyword: 1 } — why this chunk was retrieved
    text: chunk.text,
  };
}

// retrieve → (optional) rerank, i.e. everything before the model sees any text.
// Shared by answerQuestion and the evaluation script so both measure the same thing.
export async function retrieveForAnswer(question, contractIds = [], { rerank = RERANK_ENABLED } = {}) {
  if (!rerank) return retrieve(question, contractIds);
  const candidates = await retrieve(question, contractIds, 'hybrid', { pool: RERANK_CANDIDATES });
  return rerankChunks(question, candidates, { keep: TOP_K });
}

// options.rerank: true/false overrides the RERANK env setting for this one question.
// options.retrieveChunks / options.generate exist so tests can run without Gemini or MongoDB.
export async function answerQuestion(
  question,
  contractIds = [],
  { rerank = RERANK_ENABLED, retrieveChunks = retrieveForAnswer, generate = generateText } = {}
) {
  const retrieved = await retrieveChunks(question, contractIds, { rerank });
  const chunks = scopeToContracts(retrieved, contractIds);
  if (chunks.length < retrieved.length) {
    console.warn(`Dropped ${retrieved.length - chunks.length} chunk(s) from contracts outside the selection`);
  }
  const sources = chunks.map(toSource);

  if (!sources.length) {
    return {
      question, answer: NOT_FOUND, citations: [], sources: [], model: null, reranked: rerank, abstained: true,
      verification: buildVerification({ answer: NOT_FOUND, citations: [], sources, abstained: true }),
    };
  }

  const prompt = `Sources:\n\n${buildContext(sources)}\n\nQuestion: ${question}`;
  const raw = await generate({ system: SYSTEM_PROMPT, prompt });
  const extracted = extractCitations(raw || NOT_FOUND, sources);
  const abstained = isAbstention(extracted.answer);
  // An abstention carries no citations, even if the model added some
  const answer = abstained ? NOT_FOUND : extracted.answer;
  const citations = abstained ? [] : extracted.citations;

  return {
    question,
    answer,
    citations,
    sources,
    model: CHAT_MODEL,
    reranked: rerank,
    abstained,
    verification: buildVerification({ answer, citations, invalidCitations: extracted.invalidCitations, sources, abstained }),
  };
}
