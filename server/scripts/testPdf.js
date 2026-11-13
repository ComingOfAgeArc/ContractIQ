// Quick check of the PDF step on its own — no database, no server.
// Usage: npm run test:pdf -- ../samples/vendor-a-2025.pdf
import fs from 'node:fs';
import path from 'node:path';
import { extractPages } from '../services/pdfService.js';

const file = process.argv[2] || path.resolve(import.meta.dirname, '../../samples/vendor-a-2025.pdf');
const { pageCount, pages, charCount } = await extractPages(fs.readFileSync(file));

console.log(`${path.basename(file)}: ${pageCount} pages, ${charCount} characters\n`);
for (const p of pages) {
  console.log(`--- page ${p.pageNumber} (${p.text.length} chars) ---`);
  console.log(p.text.slice(0, 400) + (p.text.length > 400 ? ' …' : ''));
  console.log();
}
