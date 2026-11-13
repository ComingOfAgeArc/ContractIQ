// Offline check of eval/dataset.json: no database, no Gemini.
// A wrong "expected" section or an unreachable "mustContain" phrase would make the
// evaluation report misleading scores, so we verify the dataset against the real
// sample PDFs (chunked with the same chunker the app uses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sampleChunks, SAMPLES } from './helpers.js';

const dataset = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../eval/dataset.json'), 'utf8'));
const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');

// Default upload title = file name without ".pdf"
const titles = fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.pdf')).map((f) => f.replace(/\.pdf$/, ''));
const chunks = {};
for (const t of titles) chunks[t] = await sampleChunks(t);

test('dataset: 20-30 questions with unique ids', () => {
  const ids = dataset.questions.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate question ids');
  assert.ok(ids.length >= 20 && ids.length <= 30, `expected 20-30 questions, got ${ids.length}`);
});

test('dataset: every referenced contract is a sample PDF', () => {
  for (const q of dataset.questions) {
    for (const t of [...q.contracts, ...q.expected.map((e) => e.contract)]) {
      assert.ok(titles.includes(t), `${q.id}: no samples/${t}.pdf`);
    }
  }
});

test('dataset: each expected section exists, and the answer phrases can be found in it', () => {
  for (const q of dataset.questions.filter((x) => !x.unanswerable)) {
    assert.ok(q.expected.length > 0, `${q.id}: answerable question needs "expected"`);
    assert.ok(q.mustContain?.length > 0, `${q.id}: answerable question needs "mustContain"`);

    const text = q.expected
      .map((e) => {
        const hits = chunks[e.contract].filter((c) => c.sectionNumber === e.section);
        assert.ok(hits.length, `${q.id}: ${e.contract} has no section ${e.section}`);
        return hits.map((c) => c.text).join('\n');
      })
      .join('\n');

    for (const group of q.mustContain) {
      assert.ok(
        group.some((phrase) => norm(text).includes(norm(phrase))),
        `${q.id}: none of ${JSON.stringify(group)} appears in the expected sections`
      );
    }
  }
});

test('dataset: unanswerable questions really are unanswerable from their contracts', () => {
  for (const q of dataset.questions.filter((x) => x.unanswerable)) {
    assert.deepEqual(q.expected, [], `${q.id}: unanswerable questions have no expected sections`);
    for (const term of q.absent ?? []) {
      for (const t of q.contracts) {
        const all = norm(chunks[t].map((c) => c.text).join('\n'));
        assert.ok(!all.includes(norm(term)), `${q.id}: "${term}" appears in ${t}, so the question is answerable`);
      }
    }
  }
});
