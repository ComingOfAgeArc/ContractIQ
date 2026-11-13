import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryInput } from '../services/summaryService.js';

const contract = {
  title: 'vendor-a-2025', vendor: 'Vendor A', version: '2025',
  analysis: {
    parties: [{ name: 'Northwind', role: 'Supplier' }], effectiveDate: '2025-01-01', endDate: null, summary: 'A telemetry MSA.',
    clauses: {
      term: { label: 'Term', found: true, summary: '24 months', keyValues: [{ label: 'Initial term', value: '24 months' }], quote: 'q', verified: true, citations: [{ chunkIndex: 2 }], chunkIds: [2] },
      sla: { label: 'Service levels (SLA)', found: false, summary: 'ignored', keyValues: [{ label: 'x', value: 'y' }], quote: '', citations: [], chunkIds: [] },
    },
  },
  flags: [{ code: 'AUTO', type: 'clause', title: 'Automatic renewal', value: '12 months', detail: 'Renews automatically', citations: [{ chunkIndex: 2 }], evidence: 'long quote' }],
};

test('summary input: compact, no quotes/citations/ids, not-found clauses carry no text', () => {
  const input = buildSummaryInput(contract);
  assert.equal(input.clauses.length, 2);
  assert.deepEqual(input.clauses[0], { label: 'Term', found: true, summary: '24 months', keyValues: [{ label: 'Initial term', value: '24 months' }] });
  assert.deepEqual(input.clauses[1], { label: 'Service levels (SLA)', found: false, summary: '', keyValues: [] });
  assert.deepEqual(input.flags, [{ title: 'Automatic renewal', type: 'clause', value: '12 months', detail: 'Renews automatically' }]);
  assert.ok(!JSON.stringify(input).includes('citations'));
});

test('summary input: refuses a contract that has not been analysed', () => {
  assert.throws(() => buildSummaryInput({ ...contract, analysis: null }), /not been analysed/);
});
