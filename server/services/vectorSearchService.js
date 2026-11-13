import mongoose from 'mongoose';
import Chunk from '../models/Chunk.js';
import { embedQuery } from './embeddingService.js';
import { VECTOR_INDEX_NAME } from '../config/searchIndexes.js';

// Pipeline stages shared by vector and keyword search:
// drop the big vector, attach the contract title for citations.
export const resultStages = [
  { $project: { embedding: 0 } },
  { $lookup: { from: 'contracts', localField: 'contractId', foreignField: '_id', as: 'contract', pipeline: [{ $project: { title: 1 } }] } },
  { $set: { contractTitle: { $first: '$contract.title' } } },
  { $project: { contract: 0 } },
];

// aggregate() does NOT auto-convert strings to ObjectIds like find() does
export const toObjectIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(id));

// Already have the query vector → the most similar chunks (semantic search).
export async function searchByVector(queryVector, { contractIds = [], vendor, version, limit = 8 } = {}) {
  // Pre-filter: only compare against chunks we care about
  const filter = {};
  if (contractIds.length) filter.contractId = { $in: toObjectIds(contractIds) };
  if (vendor) filter.vendor = vendor;
  if (version) filter.version = version;

  return Chunk.aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: 'embedding',
        queryVector,
        numCandidates: limit * 20, // how many neighbours the ANN search considers before picking the top `limit`
        limit,
        ...(Object.keys(filter).length && { filter }),
      },
    },
    { $set: { score: { $meta: 'vectorSearchScore' } } }, // 0..1, higher = more similar
    ...resultStages,
  ]);
}

// question → the most similar chunks by meaning
export async function vectorSearch(question, options = {}) {
  const queryVector = await embedQuery(question);
  return searchByVector(queryVector, options);
}
