import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerBanner, clauseVerification, verificationCounts } from '../src/services/verificationView.js';

test('answer banner: each verification status gets a distinct, honest label', () => {
  const banner = (status, extra = {}) => answerBanner({ citations: [], verification: { status, message: 'm', ...extra } });
  assert.equal(banner('cited').title, 'Cited'); // never "correct" or "verified true"
  assert.equal(banner('partially_cited').tone, 'warn');
  assert.equal(banner('uncited').tone, 'bad');
  assert.equal(banner('insufficient_information').title, 'Not enough information');
});

test('answer banner: removed citations, unverified values and uncited statements are listed', () => {
  const b = answerBanner({
    citations: [{ id: 'S1' }],
    verification: {
      status: 'partially_cited', message: 'Check carefully',
      invalidCitations: ['S9'], unverifiedValues: [{ value: '150000', statement: 'Fees are EUR 150,000.' }], uncitedStatements: ['A 5% discount applies.'],
    },
  });
  assert.equal(b.details.length, 3);
  assert.match(b.details[0], /S9/);
});

test('answer banner: results from before verification existed still render', () => {
  assert.equal(answerBanner({ citations: [{ id: 'S1' }] }).status, 'cited');
  assert.equal(answerBanner({ citations: [] }).status, 'uncited');
});

test('clause verification: new field first, old boolean as fallback', () => {
  assert.equal(clauseVerification({ found: true, verification: 'unverified', verified: false }), 'unverified');
  assert.equal(clauseVerification({ found: true, verified: true }), 'verified');
  assert.equal(clauseVerification({ found: true, verified: false }), 'unverified');
  assert.equal(clauseVerification({ found: false }), 'not_found');
  assert.deepEqual(verificationCounts([{ found: true, verified: true }, { found: false }, { found: true, verification: 'unverified' }]), { verified: 1, unverified: 1, not_found: 1 });
});
