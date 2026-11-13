import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFlags } from '../services/flagService.js';
import { sampleChunks, fakeAnalysis } from './helpers.js';

async function flagsFor(name) {
  const chunks = await sampleChunks(name);
  return Object.fromEntries(computeFlags(fakeAnalysis(chunks), chunks).map((f) => [f.code, f]));
}

test('Vendor A 2025', async () => {
  const f = await flagsFor('vendor-a-2025');
  assert.match(f.AUTO_RENEWAL.detail, /60 days/);
  assert.match(f.LIABILITY_CAP.detail, /twelve \(12\) months/);
  assert.ok(f.LONG_TERMINATION_NOTICE, '90 days meets the 90-day threshold');
  assert.ok(f.PRICE_INCREASE);
  assert.equal(f.MISSING_SLA, undefined);
  assert.equal(f.LONG_INITIAL_TERM, undefined); // 24 months < 36
  assert.equal(f.SLOW_BREACH_NOTICE, undefined); // 72 hours is not above 72
  assert.equal(f.AUTO_RENEWAL.citations[0].sectionNumber, '2');
});

test('Vendor A 2026: new thresholds crossed', async () => {
  const f = await flagsFor('vendor-a-2026');
  assert.match(f.LONG_TERMINATION_NOTICE.detail, /180 days/);
  assert.match(f.LONG_INITIAL_TERM.detail, /36 months/);
  assert.match(f.LONG_RENEWAL_NOTICE.detail, /90 days/);
  assert.match(f.LIABILITY_CAP.detail, /six \(6\) months/);
});

test('Vendor B 2025: no auto-renewal, no SLA, slow breach notice', async () => {
  const f = await flagsFor('vendor-b-2025');
  assert.equal(f.AUTO_RENEWAL, undefined); // "There is no automatic renewal."
  assert.ok(f.MISSING_SLA);
  assert.match(f.SLOW_BREACH_NOTICE.detail, /5 business days/);
  assert.ok(f.NON_REFUNDABLE);
  assert.equal(f.LONG_TERMINATION_NOTICE, undefined); // 30 days
});

test('every flag has a short value for tables', async () => {
  const f = await flagsFor('vendor-a-2026');
  assert.equal(f.LIABILITY_CAP.value, '6 months of fees');
  assert.equal(f.LONG_TERMINATION_NOTICE.value, '180 days');
  assert.equal(f.PRICE_INCREASE.value, 'up to 5%');
  const b = await flagsFor('vendor-b-2025');
  assert.equal(b.LIABILITY_CAP.value, '2x charges');
  assert.equal(b.MISSING_SLA.value, 'Not found');
  for (const flag of Object.values(b)) assert.ok(flag.value, flag.code);
});
