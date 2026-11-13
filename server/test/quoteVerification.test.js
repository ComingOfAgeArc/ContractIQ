// Contract analysis: a clause reported as "found" must have verifiable evidence,
// and when verification fails the reason is recorded instead of silently dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAndCite, findQuote } from '../services/analysisService.js';

const chunks = [
  { chunkIndex: 0, sectionNumber: '1', sectionTitle: 'Term', pageStart: 1, pageEnd: 1, text: '1. Term\nThis Agreement runs for twenty-four (24) months from the Effective Date.' },
  { chunkIndex: 1, sectionNumber: '9', sectionTitle: 'Liability', pageStart: 3, pageEnd: 3, text: "9. Liability\nThe Supplier's total liability is limited to the fees paid in the 12 months before the claim. This cap does not apply to fraud." },
  { chunkIndex: 2, sectionNumber: '12', sectionTitle: 'Notices', pageStart: 4, pageEnd: 4, text: '12. Notices\nNotice must be given within 30 days.' },
];
const clause = (fields) => ({ found: true, summary: 's', keyValues: [], chunkIds: [], quote: '', ...fields });

test('verified: exact quote (case/spacing ignored) → verified, chunk cited', () => {
  const r = verifyAndCite(clause({ quote: "the supplier's total liability is LIMITED to the fees", chunkIds: [1] }), chunks);
  assert.equal(r.verification, 'verified');
  assert.equal(r.verified, true); // old boolean kept for exports / older clients
  assert.deepEqual(r.chunkIds, [1]);
  assert.equal(r.verificationNote, null);
});

test('verified: quote shortened with "…" is matched part by part, in order', () => {
  const r = verifyAndCite(clause({ quote: "The Supplier's total liability … 12 months before the claim", chunkIds: [1] }), chunks);
  assert.equal(r.verification, 'verified');
});

test('verified (loosely): punctuation differences are tolerated and noted', () => {
  const r = verifyAndCite(clause({ quote: 'The Suppliers total liability is limited to the fees paid', chunkIds: [1] }), chunks);
  assert.equal(r.verification, 'verified');
  assert.match(r.verificationNote, /punctuation/);
});

test('failed verification: invented quote → unverified with the reason recorded; cited sections kept to check', () => {
  const r = verifyAndCite(clause({ quote: 'liability is unlimited for all claims', chunkIds: [1, 42] }), chunks);
  assert.equal(r.verification, 'unverified');
  assert.equal(r.verified, false);
  assert.match(r.verificationNote, /not found in the contract/);
  assert.deepEqual(r.chunkIds, [1]); // kept so the user can read the section
  assert.deepEqual(r.invalidChunkIds, [42]); // recorded, not silently dropped
  assert.equal(r.summary, 's'); // the potentially useful summary is kept
});

test('failed verification: found but no quote → unverified, not treated as confirmed', () => {
  const r = verifyAndCite(clause({ quote: '', chunkIds: [] }), chunks);
  assert.equal(r.verification, 'unverified');
  assert.match(r.verificationNote, /No supporting quote/);
  assert.match(r.verificationNote, /No valid source section/);
});

test('not found clause → "not_found", nothing to verify', () => {
  const r = verifyAndCite({ found: false, summary: '', keyValues: [], chunkIds: [], quote: '' }, chunks);
  assert.equal(r.verification, 'not_found');
  assert.deepEqual(r.citations, []);
});

test('very short quotes only count inside the cited chunks (they match too easily elsewhere)', () => {
  assert.equal(findQuote('30 days', chunks, [0]), null); // "30 days" is in chunk 2, but chunk 0 was cited
  assert.equal(findQuote('30 days', chunks, [2]).chunk.chunkIndex, 2);
});

test('key values: numbers not present in the cited text are flagged', () => {
  const r = verifyAndCite(
    clause({
      quote: 'limited to the fees paid in the 12 months before the claim',
      chunkIds: [1],
      keyValues: [
        { label: 'Cap', value: '12 months of fees' },
        { label: 'Cap (wrong)', value: '24 months of fees' },
        { label: 'Exclusion', value: 'fraud' },
      ],
    }),
    chunks
  );
  assert.deepEqual(r.keyValues.map((kv) => kv.check), ['ok', 'not_in_text', null]);
});
