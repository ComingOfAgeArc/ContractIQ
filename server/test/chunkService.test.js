import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages, MAX_CHUNK_CHARS } from '../services/chunkService.js';
import { sampleChunks } from './helpers.js';

test('sample contract: one chunk per clause, with section and page', async () => {
  const chunks = await sampleChunks('vendor-a-2025');
  assert.equal(chunks.length, 12); // preamble + 11 clauses
  const liability = chunks.find((c) => c.sectionTitle === 'Limitation of Liability');
  assert.equal(liability.sectionNumber, '9');
  assert.equal(liability.pageStart, 3);
  assert.match(liability.text, /^9\. Limitation of Liability\n9\.1/);
});

test('numbered list inside a clause does not start new clauses', () => {
  const chunks = chunkPages([{ pageNumber: 1, text: '8. Fees\nPay.\n9. Liability\nExcluded:\n1. Death\n2. Fraud\n10. Term\nOne year.' }]);
  assert.deepEqual(chunks.map((c) => c.sectionNumber), ['8', '9', '10']);
  assert.match(chunks[1].text, /1\. Death/);
});

test('long clause is split into parts that keep the heading', () => {
  const body = Array.from({ length: 60 }, (_, i) => `The supplier shall meet obligation ${i} on security and audit.`).join('\n');
  const chunks = chunkPages([{ pageNumber: 1, text: `4. Security\n${body}` }]);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.text.length <= MAX_CHUNK_CHARS + 60);
    assert.match(c.text, /^4\. Security \(part \d of \d\)/);
  }
});

test('clause spanning two pages gets a page range', () => {
  const chunks = chunkPages([
    { pageNumber: 1, text: '1. Scope\nStarts here' },
    { pageNumber: 2, text: 'and continues here.\n2. Fees\nPay.' },
  ]);
  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks[0].pageEnd, 2);
});
