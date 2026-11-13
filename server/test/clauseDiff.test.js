import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffVersions, diffValues, extractValues } from '../services/clauseDiffService.js';
import { sampleChunks } from './helpers.js';

test('Vendor A 2025 → 2026: detects exactly the planted changes', async () => {
  const { counts, changes } = diffVersions(await sampleChunks('vendor-a-2025'), await sampleChunks('vendor-a-2026'));
  assert.deepEqual(counts, { added: 1, removed: 0, modified: 6, unchanged: 6 });

  const values = (title) => changes.find((c) => c.title === title).valueChanges.map((v) => `${v.from} → ${v.to}`);
  assert.deepEqual(values('Term and Renewal'), ['24 months → 36 months', '60 days → 90 days']);
  assert.deepEqual(values('Limitation of Liability'), ['12 months → 6 months']);
  assert.deepEqual(values('Termination'), ['90 days → 180 days']);
  assert.deepEqual(values('Service Levels'), ['99.5% → 99.9%', '5% → 10%']);
  assert.deepEqual(values('Fees and Payment'), ['EUR 120,000 → EUR 138,000']);

  assert.equal(changes.find((c) => c.status === 'added').title, 'Use of Artificial Intelligence');
  const law = changes.find((c) => c.title === 'Governing Law');
  assert.equal(law.status, 'unchanged'); // only renumbered 11 → 12
  assert.equal(law.renumbered, true);
});

test('renamed clause is matched by text similarity', () => {
  const mk = (i, n, t, body) => ({ chunkIndex: i, sectionNumber: n, sectionTitle: t, text: `${t}\n${body}`, pageStart: 1, pageEnd: 1 });
  const body = 'Customer shall pay the fee per year, invoiced annually in advance within thirty (30) days.';
  const { changes } = diffVersions([mk(0, '1', 'Fees and Payment', body)], [mk(0, '1', 'Charges', body.replace('thirty (30)', 'sixty (60)'))]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].status, 'modified');
  assert.equal(changes[0].oldTitle, 'Fees and Payment');
  assert.equal(changes[0].matchedBy, 'text');
});

test('values are normalised: "twelve (12) months" and "12 months" are equal', () => {
  assert.equal(extractValues('for twelve (12) months')[0].value, '12 months');
  assert.deepEqual(diffValues('for twelve (12) months', 'for 12 months'), []);
});

test('repeated values are compared as counts', () => {
  const changes = diffValues('Pay in 30 days. Notice 30 days.', 'Pay in 30 days. Notice 45 days.');
  assert.deepEqual(changes.map((c) => [c.from, c.to]), [['30 days', '45 days']]);
});
