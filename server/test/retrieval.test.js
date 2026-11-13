import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reciprocalRankFusion } from '../services/searchService.js';
import { parseQuery } from '../services/keywordSearchService.js';
import { extractCitations } from '../services/ragService.js';
import { verifyAndCite } from '../services/analysisService.js';

test('RRF: a chunk ranked well in both lists beats one ranked first in only one', () => {
  const fused = reciprocalRankFusion([
    { name: 'vector', results: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }] },
    { name: 'keyword', results: [{ _id: 'b' }, { _id: 'd' }] },
  ]);
  assert.equal(fused[0]._id, 'b'); // #2 + #1 beats a's single #1
  assert.deepEqual(fused[0].ranks, { vector: 2, keyword: 1 });
  assert.equal(fused.length, 4);
  assert.ok(Math.abs(fused[0].score - (1 / 62 + 1 / 61)) < 1e-12);
});

test('keyword query parsing: "quoted phrases" and loose terms', () => {
  assert.deepEqual(parseQuery('termination "30 days" notice'), { phrases: ['30 days'], terms: 'termination notice' });
  assert.deepEqual(parseQuery('"ISO/IEC 27001"'), { phrases: ['ISO/IEC 27001'], terms: '' });
});

test('citations: lists are split, unknown sources removed', () => {
  const sources = [{ id: 'S1' }, { id: 'S2' }];
  const { answer, citations } = extractCitations('Cap is 12 months [S1, S2]. Also X [S9].', sources);
  assert.equal(answer, 'Cap is 12 months [S1][S2]. Also X.');
  assert.deepEqual(citations.map((c) => c.id), ['S1', 'S2']);
});

test('quote verification: real quote verified (despite line breaks), invented quote not', () => {
  const chunks = [{ chunkIndex: 0, text: '9. Liability\nliability is limited to the fees\npaid in 12 months', sectionNumber: '9', pageStart: 3, pageEnd: 3 }];
  const real = verifyAndCite({ found: true, quote: 'limited to the fees paid in 12 months', chunkIds: [] }, chunks);
  assert.equal(real.verified, true);
  assert.deepEqual(real.chunkIds, [0]); // chunk added from the quote match
  const fake = verifyAndCite({ found: true, quote: 'unlimited liability', chunkIds: [0, 99] }, chunks);
  assert.equal(fake.verified, false);
  assert.deepEqual(fake.chunkIds, [0]); // id 99 does not exist → dropped
});
