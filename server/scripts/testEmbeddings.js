// Checks your Gemini key and shows what vector search does, with no database.
// Usage: npm run test:embed -- "How much notice do I need to cancel?"
import fs from 'node:fs';
import path from 'node:path';
import { extractPages } from '../services/pdfService.js';
import { chunkPages } from '../services/chunkService.js';
import { embedDocuments, embedQuery, documentInput } from '../services/embeddingService.js';

const question = process.argv[2] || 'How much notice is needed to cancel the contract?';
const file = path.resolve(import.meta.dirname, '../../samples/vendor-a-2025.pdf');

const { pages } = await extractPages(fs.readFileSync(file));
const chunks = chunkPages(pages);

const chunkVectors = await embedDocuments(chunks.map((c) => documentInput('Vendor A 2025', c.text)));
const queryVector = await embedQuery(question);
console.log(`Vector length: ${queryVector.length}\n`);

// Cosine similarity: how closely two vectors point the same way (1 = identical meaning).
// This is exactly what Atlas computes; it just does it fast over millions of vectors.
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const ranked = chunks
  .map((c, i) => ({ heading: c.text.split('\n')[0], page: c.pageStart, score: cosine(queryVector, chunkVectors[i]) }))
  .sort((a, b) => b.score - a.score);

console.log(`Q: ${question}\n`);
for (const r of ranked.slice(0, 5)) console.log(`${r.score.toFixed(3)}  p${r.page}  ${r.heading}`);
