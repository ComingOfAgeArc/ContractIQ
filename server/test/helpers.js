// Shared test helpers: load a sample PDF and build a stand-in "analysis"
// without calling Gemini, by mapping clause headings to clause types.
import fs from 'node:fs';
import path from 'node:path';
import { extractPages } from '../services/pdfService.js';
import { chunkPages } from '../services/chunkService.js';

export const SAMPLES = path.resolve(import.meta.dirname, '../../samples');

export async function sampleChunks(name) {
  const { pages } = await extractPages(fs.readFileSync(path.join(SAMPLES, `${name}.pdf`)));
  return chunkPages(pages);
}

const HEADING_TO_TYPE = {
  term: /Term and Renewal|Subscription Period/,
  renewal: /Term and Renewal|Subscription Period/,
  termination: /Termination|Ending the Agreement/,
  payment: /Fees|Charges/,
  liability: /Liabilit/,
  indemnification: /Indemn/,
  confidentiality: /Confidential|Non-Disclosure/,
  dataProtection: /Data Protection|Privacy/,
  sla: /Service Levels/,
  ip: /Intellectual|Ownership/,
  governingLaw: /Law/,
};

export function fakeAnalysis(chunks) {
  const clauses = {};
  for (const [key, re] of Object.entries(HEADING_TO_TYPE)) {
    const hits = chunks.filter((c) => re.test(c.sectionTitle));
    clauses[key] = {
      found: hits.length > 0,
      chunkIds: hits.map((c) => c.chunkIndex),
      citations: hits.map((c) => ({ chunkIndex: c.chunkIndex, sectionNumber: c.sectionNumber, pageStart: c.pageStart, pageEnd: c.pageEnd })),
    };
  }
  return { clauses };
}
