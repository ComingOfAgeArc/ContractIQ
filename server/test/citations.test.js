// Citation reliability for Q&A: fake/unknown source ids, chunks from other
// contracts, abstentions, empty retrieval, and the per-statement checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, buildVerification, extractCitations, isAbstention, scopeToContracts, NOT_FOUND } from '../services/ragService.js';
import { checkStatements, extractNumbers, needsCitation, splitStatements, unsupportedNumbers } from '../services/groundingService.js';

const A = '64b7f0c2a1b2c3d4e5f600aa';
const B = '64b7f0c2a1b2c3d4e5f600bb';
const chunk = (id, contractId, text, extra = {}) => ({
  _id: id, contractId, chunkIndex: Number(id.slice(-1)), contractTitle: `contract-${contractId.slice(-2)}`, vendor: 'Vendor', version: '2025',
  sectionNumber: '9', sectionTitle: 'Liability', pageStart: 3, pageEnd: 3, text, score: 0.03, ranks: { vector: 1 }, ...extra,
});

test('citations: unknown ids are removed AND reported; formats like [s1] and [S1; S2] are normalised', () => {
  const sources = [{ id: 'S1' }, { id: 'S2' }];
  const out = extractCitations('Cap applies [s1]. Notice is set [S1; S2]. Made up [S7][S2].', sources);
  assert.equal(out.answer, 'Cap applies [S1]. Notice is set [S1][S2]. Made up [S2].');
  assert.deepEqual(out.citations.map((c) => c.id), ['S1', 'S2']);
  assert.deepEqual(out.invalidCitations, ['S7']);
});

test('citations: chunks from contracts outside the selection never reach the prompt', () => {
  const chunks = [chunk('c1', A, 'x'), chunk('c2', B, 'y'), chunk('c3', A, 'z')];
  assert.deepEqual(scopeToContracts(chunks, [A]).map((c) => c._id), ['c1', 'c3']);
  assert.equal(scopeToContracts(chunks, []).length, 3); // nothing selected = all contracts
});

test('answer: a chunk from another contract that slips through retrieval is dropped and cannot be cited', async () => {
  let prompt = '';
  const result = await answerQuestion('What is the cap?', [A], {
    retrieveChunks: async () => [chunk('c1', A, 'Liability is capped at 12 months of fees.'), chunk('c2', B, 'Liability is unlimited.')],
    generate: async (p) => {
      prompt = p.prompt;
      return 'The cap is 12 months of fees [S1]. It is unlimited [S2].'; // S2 would be the other contract
    },
  });
  assert.ok(!prompt.includes('unlimited'), 'other contract text must not be in the prompt');
  assert.deepEqual(result.sources.map((s) => String(s.contractId)), [A]);
  assert.deepEqual(result.citations.map((c) => c.id), ['S1']);
  assert.deepEqual(result.verification.invalidCitations, ['S2']);
  assert.equal(result.verification.status, 'partially_cited');
  // every citation carries what the UI needs to open the clause in its own contract
  assert.equal(String(result.citations[0].contractId), A);
  assert.equal(result.citations[0].chunkIndex, 1);
});

test('answer: empty retrieval → "not found", no AI call, insufficient-information status', async () => {
  let called = false;
  const result = await answerQuestion('Is there a non-compete?', [A], {
    retrieveChunks: async () => [],
    generate: async () => {
      called = true;
      return 'x';
    },
  });
  assert.equal(called, false);
  assert.equal(result.answer, NOT_FOUND);
  assert.equal(result.abstained, true);
  assert.deepEqual(result.citations, []);
  assert.equal(result.verification.status, 'insufficient_information');
});

test('answer: the model abstains (even with a stray marker) → no citations, clear message', async () => {
  assert.equal(isAbstention(`${NOT_FOUND} [S1]`), true);
  assert.equal(isAbstention('The notice period is 30 days [S1].'), false);
  const result = await answerQuestion('Is there a non-compete?', [], {
    retrieveChunks: async () => [chunk('c1', A, 'Liability is capped.')],
    generate: async () => `${NOT_FOUND} [S1]`,
  });
  assert.equal(result.abstained, true);
  assert.equal(result.answer, NOT_FOUND);
  assert.deepEqual(result.citations, []);
  assert.match(result.verification.message, /do not contain enough information/);
});

test('answer: no valid citation at all → "uncited" (unsupported), not presented as backed by the contract', async () => {
  const result = await answerQuestion('What is the cap?', [], {
    retrieveChunks: async () => [chunk('c1', A, 'Liability is capped at 12 months of fees.')],
    generate: async () => 'The cap is two million euros [S4].',
  });
  assert.deepEqual(result.citations, []);
  assert.equal(result.verification.status, 'uncited');
  assert.deepEqual(result.verification.invalidCitations, ['S4']);
});

test('answer: fully cited, numbers present in the cited text → "cited"', async () => {
  const result = await answerQuestion('Termination notice?', [], {
    retrieveChunks: async () => [chunk('c1', A, 'Either party may terminate on ninety (90) days written notice.')],
    generate: async () => 'Either party may terminate for convenience with 90 days written notice [S1].',
  });
  assert.equal(result.verification.status, 'cited');
  assert.deepEqual(result.verification.unverifiedValues, []);
});

test('verification: a number that is not in its cited source is flagged', () => {
  const sources = [{ id: 'S1', text: 'Fees are EUR 120,000 per year.', vendor: 'A', version: '2025' }];
  const v = buildVerification({ answer: 'Fees are EUR 150,000 per year [S1].', citations: sources, sources, abstained: false });
  assert.equal(v.status, 'partially_cited');
  assert.deepEqual(v.unverifiedValues.map((x) => x.value), ['150000']);
});

test('verification: factual statement with no citation is listed; "not stated" sentences do not need one', () => {
  const sources = [{ id: 'S1', text: 'Notice: 30 days.' }];
  const answer = 'Notice is 30 days [S1].\nThe contract also requires a 5% discount on renewal.\nThe governing law is not stated.';
  const v = buildVerification({ answer, citations: sources, sources, abstained: false });
  assert.equal(v.status, 'partially_cited');
  assert.deepEqual(v.uncitedStatements, ['The contract also requires a 5% discount on renewal.']);
});

test('statements: one citation at the end of a paragraph covers the sentences before it', () => {
  const sources = [{ id: 'S1', text: 'The term is twelve (12) months and renews automatically.' }];
  const checks = checkStatements('The term is 12 months. It renews automatically [S1].', sources);
  assert.equal(checks.length, 2);
  assert.equal(checks[0].inherited, true);
  assert.equal(checks[0].uncited, false);
  assert.deepEqual(checks[0].unsupportedValues, []);
});

test('grounding helpers: numbers, spelled-out numbers, statements and headings', () => {
  assert.deepEqual(extractNumbers('EUR 120,000 and 99.90% within 72 hours [S3]'), ['120000', '99.9', '72']);
  assert.deepEqual(unsupportedNumbers('30 days', ['thirty days']), []); // "thirty" counts as 30
  assert.deepEqual(unsupportedNumbers('45 days', ['thirty days']), ['45']);
  assert.deepEqual(splitStatements('- Vendor A 2025:\n- Cap is 12 months [S1]. Excludes fraud [S1].').map((s) => s.text), [
    'Vendor A 2025:', 'Cap is 12 months [S1].', 'Excludes fraud [S1].',
  ]);
  assert.equal(needsCitation('Vendor A 2025:'), false);
  assert.equal(needsCitation('Vendor B does not specify a cap.'), false);
  assert.equal(needsCitation('Notice is 30 days.'), true);
});
