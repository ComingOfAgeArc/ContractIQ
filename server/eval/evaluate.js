// Evaluation logic (the CLI wrapper is scripts/evaluate.js).
//
// Two layers, measured separately so you know WHICH part to fix:
//
// Retrieval (for each mode: vector / keyword / hybrid)
//   recall@K – share of expected sections that appear in the top K chunks
//   MRR      – 1 / rank of the first correct chunk (1.0 = always first)
//
// Optional 4th retrieval variant "hybrid+rerank" (npm run eval -- --rerank):
//   same hybrid search, wider pool, then Gemini reranks (see rerankService).
//   Compare its recall@K / MRR with plain "hybrid" to see if reranking helps.
//
// Answers (hybrid mode, calls Gemini)
//   facts      – every "mustContain" group appears in the answer
//   citations  – the answer cites at least one expected section
//   abstention – unanswerable questions get "not found" and no citations
import { retrieve, retrieveForAnswer, answerQuestion, NOT_FOUND } from '../services/ragService.js';
import { RERANK_ENABLED } from '../services/rerankService.js';

const MODES = ['vector', 'keyword', 'hybrid'];
export const RERANK_MODE = 'hybrid+rerank';
const K = 8;

const sameSection = (chunk, exp, idsByTitle) =>
  String(chunk.contractId) === String(idsByTitle[exp.contract]) && String(chunk.sectionNumber) === exp.section;

function scoreRetrieval(results, expected, idsByTitle) {
  if (!expected.length) return null; // unanswerable: nothing to find
  const top = results.slice(0, K);
  const found = expected.filter((exp) => top.some((c) => sameSection(c, exp, idsByTitle)));
  const firstRank = top.findIndex((c) => expected.some((exp) => sameSection(c, exp, idsByTitle)));
  return { recall: found.length / expected.length, rr: firstRank >= 0 ? 1 / (firstRank + 1) : 0, firstRank: firstRank + 1 || null };
}

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');

function scoreAnswer(result, q, idsByTitle) {
  const answer = norm(result.answer);
  if (q.unanswerable) {
    const abstained = answer.includes(norm(NOT_FOUND)) || /could not find|not (stated|specified|mentioned)|does not (contain|specify|mention)/.test(answer);
    return { abstained, noCitations: result.citations.length === 0 };
  }
  const facts = (q.mustContain ?? []).every((group) => group.some((phrase) => answer.includes(norm(phrase))));
  const cited = result.citations.some((c) => q.expected.some((exp) => sameSection(c, exp, idsByTitle)));
  return { facts, cited };
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// idsByTitle: { "vendor-a-2025": "<contract _id>", ... }
// rerank: also measure the "hybrid+rerank" retrieval variant (extra Gemini calls)
export async function evaluate(dataset, idsByTitle, { answers = true, rerank = false, delayMs = 500, log = console.log } = {}) {
  const rows = [];
  const modes = rerank ? [...MODES, RERANK_MODE] : MODES;

  for (const q of dataset.questions) {
    const contractIds = q.contracts.map((t) => idsByTitle[t]);
    const row = { id: q.id, question: q.question, retrieval: {}, answer: null };

    for (const mode of modes) {
      const results =
        mode === RERANK_MODE
          ? await retrieveForAnswer(q.question, contractIds, { rerank: true })
          : await retrieve(q.question, contractIds, mode);
      row.retrieval[mode] = scoreRetrieval(results, q.expected, idsByTitle);
      if (mode === RERANK_MODE) await sleep(delayMs);
    }

    if (answers) {
      const result = await answerQuestion(q.question, contractIds);
      row.answer = { ...scoreAnswer(result, q, idsByTitle), text: result.answer };
      await sleep(delayMs); // be gentle with free-tier rate limits
    }

    const r = row.retrieval.hybrid;
    log(`${q.id.padEnd(22)} ${r ? `hybrid recall ${r.recall.toFixed(2)} rank ${r.firstRank ?? '-'}` : 'unanswerable'.padEnd(29)}  ${row.answer ? JSON.stringify(Object.fromEntries(Object.entries(row.answer).filter(([k]) => k !== 'text'))) : ''}`);
    rows.push(row);
  }

  // ---- summary ----
  const answerable = rows.filter((r) => r.retrieval.hybrid);
  const summary = { K, questions: rows.length, retrieval: {}, answers: null, answersUseRerank: answers ? RERANK_ENABLED : null };
  for (const mode of modes) {
    summary.retrieval[mode] = {
      [`recall@${K}`]: avg(answerable.map((r) => r.retrieval[mode].recall)),
      MRR: avg(answerable.map((r) => r.retrieval[mode].rr)),
    };
  }
  if (answers) {
    const withAnswer = rows.filter((r) => r.answer && !('abstained' in r.answer));
    const unanswerable = rows.filter((r) => r.answer && 'abstained' in r.answer);
    summary.answers = {
      factAccuracy: avg(withAnswer.map((r) => (r.answer.facts ? 1 : 0))),
      citationAccuracy: avg(withAnswer.map((r) => (r.answer.cited ? 1 : 0))),
      abstentionAccuracy: avg(unanswerable.map((r) => (r.answer.abstained && r.answer.noCitations ? 1 : 0))),
    };
  }
  return { summary, rows };
}
