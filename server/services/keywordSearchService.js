// Keyword (full-text) search with Atlas Search ($search, Lucene BM25 ranking).
//
// Why have this next to vector search? Embeddings are great at meaning
// ("cancel" ≈ "terminate") but weak at exact tokens: "ISO/IEC 27001",
// "Schedule 1", "EUR 120,000", a clause number. Keyword search nails those.
import Chunk from '../models/Chunk.js';
import { TEXT_INDEX_NAME } from '../config/searchIndexes.js';
import { resultStages, toObjectIds } from './vectorSearchService.js';

// Supports "exact phrases" in double quotes plus normal words:
//   termination "30 days"  → must contain the phrase "30 days", ranked by "termination"
export function parseQuery(query) {
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);
  const terms = query.replace(/"[^"]*"/g, ' ').replace(/\s+/g, ' ').trim();
  return { phrases, terms };
}

export async function keywordSearch(query, { contractIds = [], vendor, version, limit = 8 } = {}) {
  const { phrases, terms } = parseQuery(query);
  if (!phrases.length && !terms) return [];

  // filter = must match, but does not affect the score
  const filter = [];
  if (contractIds.length) filter.push({ in: { path: 'contractId', value: toObjectIds(contractIds) } });
  if (vendor) filter.push({ equals: { path: 'vendor', value: vendor } });
  if (version) filter.push({ equals: { path: 'version', value: version } });

  const compound = {
    filter,
    must: phrases.map((p) => ({ phrase: { query: p, path: 'text' } })),
    should: terms
      ? [
          { text: { query: terms, path: 'text' } },
          // a word in the clause TITLE counts double
          { text: { query: terms, path: 'sectionTitle', score: { boost: { value: 2 } } } },
        ]
      : [],
  };
  if (terms) compound.minimumShouldMatch = 1;

  return Chunk.aggregate([
    { $search: { index: TEXT_INDEX_NAME, compound } },
    { $limit: limit },
    { $set: { score: { $meta: 'searchScore' } } }, // BM25 score: unbounded, only meaningful as a ranking
    ...resultStages,
  ]);
}
