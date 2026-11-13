// See how a PDF is chunked — no database, no API key.
// Usage: npm run test:chunks -- ../samples/vendor-b-2025.pdf
import fs from 'node:fs';
import path from 'node:path';
import { extractPages } from '../services/pdfService.js';
import { chunkPages } from '../services/chunkService.js';

const file = process.argv[2] || path.resolve(import.meta.dirname, '../../samples/vendor-a-2025.pdf');
const { pages } = await extractPages(fs.readFileSync(file));
const chunks = chunkPages(pages);

console.log(`${path.basename(file)} → ${chunks.length} chunks\n`);
for (const c of chunks) {
  const pagesLabel = c.pageStart === c.pageEnd ? `p${c.pageStart}` : `p${c.pageStart}-${c.pageEnd}`;
  const firstLine = c.text.split('\n')[0];
  console.log(`#${String(c.chunkIndex).padStart(2)}  ${pagesLabel.padEnd(6)} ${String(c.text.length).padStart(5)} chars  ${firstLine}`);
}
