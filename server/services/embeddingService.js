import { getGemini, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from '../config/gemini.js';
import { withRetry } from './geminiService.js';

const BATCH_SIZE = 20; // texts per API call

// gemini-embedding-2 has no taskType option. Instead, the text itself says
// whether it is a document to be found or a question looking for documents.
// Using different prefixes for the two sides is "asymmetric retrieval".
export function documentInput(title, text) {
  return `title: ${title || 'none'} | text: ${text}`;
}

export function queryInput(question) {
  return `task: search result | query: ${question}`;
}

// One API call for up to BATCH_SIZE texts (retried when rate-limited)
async function embedBatch(texts) {
  const res = await withRetry(() =>
    getGemini().models.embedContent({
      model: EMBEDDING_MODEL,
      // Each text wrapped as its own Content → one vector per text.
      // (Passing a plain array of strings would give ONE merged vector.)
      contents: texts.map((text) => ({ parts: [{ text }] })),
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    })
  );
  const vectors = res.embeddings.map((e) => e.values);
  if (vectors.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${vectors.length}`);
  }
  return vectors;
}

// Many texts → many vectors, in the same order.
// onProgress(done, total) is called after each batch (used for the progress bar).
export async function embedDocuments(texts, { onProgress } = {}) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    vectors.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE))));
    await onProgress?.(vectors.length, texts.length);
  }
  return vectors;
}

export async function embedQuery(question) {
  const [vector] = await embedBatch([queryInput(question)]);
  return vector;
}
