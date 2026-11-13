import { EMBEDDING_DIMENSIONS } from './gemini.js';

// Two Atlas indexes on the "chunks" collection (the free M0 tier allows 3 in total).

// 1) VECTOR index — semantic search by meaning ($vectorSearch)
export const VECTOR_INDEX_NAME = 'chunk_vector_index';
export const vectorIndexDefinition = {
  fields: [
    { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIMENSIONS, similarity: 'cosine' },
    // "filter" fields: $vectorSearch may only pre-filter on fields listed here
    { type: 'filter', path: 'contractId' },
    { type: 'filter', path: 'vendor' },
    { type: 'filter', path: 'version' },
  ],
};

// 2) TEXT index — keyword search with BM25 ranking ($search)
// lucene.english = lower-casing + stemming ("terminates" matches "termination"'s stem "termin")
export const TEXT_INDEX_NAME = 'chunk_text_index';
export const textIndexDefinition = {
  mappings: {
    dynamic: false, // index only the fields below
    fields: {
      text: { type: 'string', analyzer: 'lucene.english' },
      sectionTitle: { type: 'string', analyzer: 'lucene.english' },
      contractId: { type: 'objectId' }, // lets us filter by contract
      vendor: { type: 'token' },        // exact-match filter
      version: { type: 'token' },
    },
  },
};

export const SEARCH_INDEXES = [
  { name: VECTOR_INDEX_NAME, type: 'vectorSearch', definition: vectorIndexDefinition },
  { name: TEXT_INDEX_NAME, type: 'search', definition: textIndexDefinition },
];
