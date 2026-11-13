// Version diff on two PDFs — no database, no API key.
// Usage: npm run test:diff -- ../samples/vendor-a-2025.pdf ../samples/vendor-a-2026.pdf
import fs from 'node:fs';
import path from 'node:path';
import { extractPages } from '../services/pdfService.js';
import { chunkPages } from '../services/chunkService.js';
import { diffVersions } from '../services/clauseDiffService.js';

const samples = path.resolve(import.meta.dirname, '../../samples');
const [oldFile = `${samples}/vendor-a-2025.pdf`, newFile = `${samples}/vendor-a-2026.pdf`] = process.argv.slice(2);
const chunksOf = async (f) => chunkPages((await extractPages(fs.readFileSync(f))).pages);

const { counts, changes } = diffVersions(await chunksOf(oldFile), await chunksOf(newFile));
console.log(counts, '\n');
for (const c of changes) {
  const s = (n) => n ?? "–";
  const sections = c.status === 'added' ? `§${s(c.newSection)}` : c.status === 'removed' ? `§${s(c.oldSection)}` : `§${s(c.oldSection)}→§${s(c.newSection)}`;
  console.log(`${c.id.padEnd(4)} ${c.status.padEnd(9)} ${sections.padEnd(9)} ${c.title}${c.oldTitle ? ` (was "${c.oldTitle}")` : ''}`);
  for (const v of c.valueChanges) console.log(`       ${v.kind.padEnd(8)} ${v.from ?? '—'} → ${v.to ?? '—'}   "${v.context}…"`);
}
