import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyScores, buildRerankPrompt, rerankChunks } from '../services/rerankService.js';

const chunk = (id, contractId = 'c1', extra = {}) => ({ _id: id, contractId, text: `text ${id}`, sectionNumber: id, sectionTitle: `T${id}`, ranks: { vector: 1 }, ...extra });

test('rerank: best score first, trimmed to keep, original ranks preserved', () => {
  const chunks = ['1', '2', '3', '4'].map((id) => chunk(id));
  const out = applyScores(chunks, [{ id: 0, score: 2 }, { id: 1, score: 9 }, { id: 2, score: 5 }, { id: 3, score: 1 }], { keep: 2 });
  assert.deepEqual(out.map((c) => c._id), ['2', '3']);
  assert.equal(out[0].rerankScore, 9);
  assert.deepEqual(out[0].ranks, { vector: 1, rerank: 1 });
  assert.equal(out[1].ranks.rerank, 2);
});

test('rerank: ties keep the hybrid order; unscored chunks count as 0', () => {
  const chunks = ['a', 'b', 'c'].map((id) => chunk(id));
  const out = applyScores(chunks, [{ id: 2, score: 5 }, { id: 0, score: 5 }], { keep: 3 });
  assert.deepEqual(out.map((c) => c._id), ['a', 'c', 'b']);
  assert.equal(out[2].rerankScore, 0);
});

test('rerank: junk from the model is ignored (bad ids, non-numbers, out-of-range scores)', () => {
  const chunks = [chunk('a'), chunk('b')];
  const out = applyScores(chunks, [{ id: 99, score: 10 }, { id: -1, score: 10 }, { id: 'x', score: 10 }, { id: 1, score: 'high' }, { id: 0, score: 50 }], { keep: 2 });
  assert.equal(out[0]._id, 'a');
  assert.equal(out[0].rerankScore, 10); // clamped to 0-10
  assert.equal(out[1].rerankScore, 0);
  assert.deepEqual(applyScores(chunks, undefined, { keep: 2 }).map((c) => c._id), ['a', 'b']);
});

test('rerank: with several contracts, each keeps its best chunks even when another scores higher', () => {
  const chunks = [chunk('a1', 'A'), chunk('a2', 'A'), chunk('a3', 'A'), chunk('b1', 'B')];
  const scores = [{ id: 0, score: 9 }, { id: 1, score: 8 }, { id: 2, score: 7 }, { id: 3, score: 1 }];
  const out = applyScores(chunks, scores, { keep: 2, minPerContract: 1 });
  assert.deepEqual(out.map((c) => c._id).sort(), ['a1', 'b1']); // B survives
});

test('rerank: prompt numbers every passage and names the contract/section', () => {
  const p = buildRerankPrompt('Notice period?', [chunk('1', 'A', { contractTitle: 'vendor-a-2025', vendor: 'Vendor A', version: '2025' }), chunk('2')]);
  assert.match(p, /Question: Notice period\?/);
  assert.match(p, /\[0\] vendor-a-2025 \| Vendor A 2025 \| Section 1\. T1/);
  assert.match(p, /\[1\] /);
});

test('rerank: if Gemini is unavailable, falls back to the hybrid order instead of throwing', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY; // getGemini() throws "GEMINI_API_KEY is not set"
  const warn = console.warn;
  console.warn = () => {};
  try {
    const chunks = ['a', 'b', 'c'].map((id) => chunk(id));
    const out = await rerankChunks('q', chunks, { keep: 2 });
    assert.deepEqual(out.map((c) => c._id), ['a', 'b']);
  } finally {
    console.warn = warn;
    if (saved) process.env.GEMINI_API_KEY = saved;
  }
});
