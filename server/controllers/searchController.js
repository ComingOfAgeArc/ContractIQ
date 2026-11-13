import mongoose from 'mongoose';
import { search as runSearch, searchAcrossContracts, SEARCH_MODES } from '../services/searchService.js';

// POST /api/search
// body: { query, mode?, contractIds?, vendor?, version?, limit?, groupByContract? }
//   mode: "hybrid" (default) | "vector" | "keyword"
//   groupByContract=false → one ranked list across everything
//   groupByContract=true  → best `limit` matches FROM EACH contract
export async function search(req, res) {
  const { query, contractIds = [], vendor, version, groupByContract = false, mode = 'hybrid' } = req.body;

  if (typeof query !== 'string' || !query.trim()) return res.status(400).json({ error: 'query is required' });
  if (query.length > 500) return res.status(400).json({ error: 'query is too long (max 500 characters)' });
  // Filters go straight into MongoDB queries: only plain strings, never objects like {"$ne": null}
  if ([vendor, version].some((v) => v != null && typeof v !== 'string')) {
    return res.status(400).json({ error: 'vendor and version must be strings' });
  }
  if (!SEARCH_MODES.includes(mode)) return res.status(400).json({ error: `mode must be one of: ${SEARCH_MODES.join(', ')}` });
  if (!Array.isArray(contractIds) || !contractIds.every((id) => mongoose.isValidObjectId(id))) {
    return res.status(400).json({ error: 'contractIds must be an array of valid ids' });
  }

  if (groupByContract) {
    const perContract = Math.min(Math.max(Number(req.body.limit) || 3, 1), 5);
    const groups = await searchAcrossContracts(query.trim(), contractIds, { perContract, mode });
    return res.json({ query, mode, groups });
  }

  const limit = Math.min(Math.max(Number(req.body.limit) || 8, 1), 20);
  const results = await runSearch(query.trim(), { mode, contractIds, vendor, version, limit });
  res.json({ query, mode, count: results.length, results });
}
