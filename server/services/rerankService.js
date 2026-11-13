// Reranking: a second, more careful look at the chunks hybrid search found.
//
// Hybrid search (searchService) is fast but approximate: it scores the question
// and each chunk SEPARATELY. A reranker reads the question TOGETHER with each
// candidate and scores "does this passage actually answer it?". The usual recipe:
//
//   retrieve wide (≈20 candidates)  →  rerank  →  keep the best few (≈8)  →  answer
//
// Here Gemini is the reranker (no new vendor or package). It is OFF by default:
// set RERANK=on in server/.env to use it for /api/ask. If the rerank call fails
// for any reason, we silently fall back to the original hybrid order, so asking
// a question never breaks because of this step.
import { generateJson } from './geminiService.js';

export const RERANK_ENABLED = /^(on|true|1)$/i.test(process.env.RERANK || '');
export const RERANK_CANDIDATES = 20; // how many chunks to retrieve before reranking

const scoreSchema = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The [number] of the passage' },
          score: { type: 'integer', description: '0 (irrelevant) to 10 (directly answers the question)' },
        },
        required: ['id', 'score'],
      },
    },
  },
  required: ['scores'],
};

const SYSTEM_PROMPT = `You rate how well contract passages answer a question.
- Score every passage from 0 to 10. 10 = states the answer directly. 5 = related but incomplete. 0 = irrelevant.
- Judge only what the passage text says. Do not use outside knowledge.
- A passage from a different contract than the question asks about scores low.
- Return one entry per passage, using the passage's [number] as id.`;

const label = (c) =>
  `${c.contractTitle ?? c.vendor ?? 'contract'} | ${c.vendor ?? ''} ${c.version ?? ''} | ` +
  `Section ${c.sectionNumber ? c.sectionNumber + '. ' : ''}${c.sectionTitle ?? ''}`;

export function buildRerankPrompt(question, chunks) {
  const passages = chunks.map((c, i) => `[${i}] ${label(c)}\n${c.text}`).join('\n\n---\n\n');
  return `Question: ${question}\n\nPassages:\n\n${passages}`;
}

// scores from the model → chunks sorted best-first, trimmed to `keep`.
// Pure function (no API call), so it is unit-tested.
//
// minPerContract: when several contracts are being compared, make sure each one
// keeps its best chunk(s) even if another contract's chunks score higher.
// Otherwise reranking could silently drop one side of a comparison.
export function applyScores(chunks, scores, { keep = 8, minPerContract = 2 } = {}) {
  const byId = new Map();
  for (const s of scores ?? []) {
    if (Number.isInteger(s?.id) && s.id >= 0 && s.id < chunks.length && Number.isFinite(s.score)) {
      byId.set(s.id, Math.max(0, Math.min(10, s.score)));
    }
  }
  // Chunks the model forgot to score get 0; the stable sort keeps hybrid order among ties
  const scored = chunks.map((c, i) => ({ chunk: c, i, rerankScore: byId.get(i) ?? 0 }));
  scored.sort((a, b) => b.rerankScore - a.rerankScore || a.i - b.i);

  const chosen = new Set();
  const contractIds = [...new Set(chunks.map((c) => String(c.contractId)))];
  if (contractIds.length > 1) {
    for (const id of contractIds) {
      scored
        .filter((s) => String(s.chunk.contractId) === id)
        .slice(0, minPerContract)
        .forEach((s) => chosen.add(s.i));
    }
  }
  for (const s of scored) {
    if (chosen.size >= keep) break;
    chosen.add(s.i);
  }

  return scored
    .filter((s) => chosen.has(s.i))
    .slice(0, Math.max(keep, chosen.size))
    .map((s, position) => ({
      ...s.chunk,
      rerankScore: s.rerankScore,
      ranks: { ...s.chunk.ranks, rerank: position + 1 }, // UI shows "rerank #1"
    }));
}

// Main entry point. Never throws: on any failure returns the first `keep` chunks unchanged.
export async function rerankChunks(question, chunks, { keep = 8, minPerContract = 2 } = {}) {
  if (chunks.length <= 1) return chunks;
  try {
    const { scores } = await generateJson({
      system: SYSTEM_PROMPT,
      prompt: buildRerankPrompt(question, chunks),
      schema: scoreSchema,
    });
    return applyScores(chunks, scores, { keep, minPerContract });
  } catch (err) {
    console.warn('Rerank failed, using hybrid order:', err.message);
    return chunks.slice(0, keep);
  }
}
