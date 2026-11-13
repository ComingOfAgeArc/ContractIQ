// One entry point for all search modes, used by the Search page, Ask (RAG) and more.
//
//   vector  → meaning       ($vectorSearch)
//   keyword → exact words   ($search, BM25)
//   hybrid  → both, merged with Reciprocal Rank Fusion (default)
import Contract from '../models/Contract.js';
import { embedQuery } from './embeddingService.js';
import { searchByVector } from './vectorSearchService.js';
import { keywordSearch } from './keywordSearchService.js';

export const SEARCH_MODES = ['hybrid', 'vector', 'keyword'];
const RRF_K = 60; // standard constant from the RRF paper; dampens the gap between rank 1 and rank 2

// Reciprocal Rank Fusion: merge ranked lists without comparing their scores.
// Vector scores (0..1) and BM25 scores (0..∞) are on different scales, so
// we only use each result's RANK:  score = Σ 1 / (k + rank)
// A chunk ranked well in BOTH lists beats one ranked first in only one.
export function reciprocalRankFusion(lists, k = RRF_K) {
  const fused = new Map();
  for (const { name, results } of lists) {
    results.forEach((doc, index) => {
      const rank = index + 1;
      const id = String(doc._id);
      const entry = fused.get(id) ?? { ...doc, score: 0, ranks: {} };
      entry.score += 1 / (k + rank);
      entry.ranks[name] = rank; // kept so the UI can show "vector #1 · keyword #3"
      fused.set(id, entry);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

// question → chunks, in the requested mode.
// Pass `queryVector` if you already embedded the question (saves an API call).
export async function search(question, { mode = 'hybrid', contractIds = [], vendor, version, limit = 8, queryVector } = {}) {
  const filters = { contractIds, vendor, version };

  if (mode === 'keyword') {
    return (await keywordSearch(question, { ...filters, limit })).map((r, i) => ({ ...r, ranks: { keyword: i + 1 } }));
  }

  const vector = queryVector ?? (await embedQuery(question));
  if (mode === 'vector') {
    return (await searchByVector(vector, { ...filters, limit })).map((r, i) => ({ ...r, ranks: { vector: i + 1 } }));
  }

  // hybrid: fetch more candidates from each side than we need, fuse, then cut
  const candidates = Math.max(limit * 3, 20);
  const [vectorResults, keywordResults] = await Promise.all([
    searchByVector(vector, { ...filters, limit: candidates }),
    keywordSearch(question, { ...filters, limit: candidates }).catch((err) => {
      // e.g. text index not created yet: still return vector results
      console.warn('Keyword search failed, using vector only:', err.message);
      return [];
    }),
  ]);
  return reciprocalRankFusion([
    { name: 'vector', results: vectorResults },
    { name: 'keyword', results: keywordResults },
  ]).slice(0, limit);
}

// Search each contract separately with the same query, so every contract gets
// its own top results (a long contract can't crowd out the rest).
export async function searchPerContract(question, contractIds, { perContract = 3, mode = 'hybrid' } = {}) {
  const queryVector = mode === 'keyword' ? undefined : await embedQuery(question); // embed once
  const lists = await Promise.all(
    contractIds.map((id) => search(question, { mode, contractIds: [id], limit: perContract, queryVector }))
  );
  return contractIds.map((id, i) => ({ contractId: id, results: lists[i] }));
}

// "How does EACH contract handle X?" → one group per contract
export async function searchAcrossContracts(question, contractIds = [], { perContract = 3, mode = 'hybrid' } = {}) {
  const contracts = await Contract.find({
    status: { $in: ['embedded', 'analyzed'] },
    ...(contractIds.length && { _id: { $in: contractIds } }),
  })
    .select('title vendor version')
    .sort({ vendor: 1, version: 1 })
    .lean();

  const groups = await searchPerContract(question, contracts.map((c) => String(c._id)), { perContract, mode });
  return groups.map((g, i) => ({ contract: contracts[i], results: g.results }));
}
