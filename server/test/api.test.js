// HTTP-level tests of the status / retry / upload / search endpoints.
// The Express app runs for real on a random port; only the MongoDB model calls are faked.
import { test, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import app from '../app.js';
import Contract from '../models/Contract.js';

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());
afterEach(() => mock.restoreAll());

const A = '64b7f0c2a1b2c3d4e5f60701';
const B = '64b7f0c2a1b2c3d4e5f60702';

// Contract.find(...).select(...).lean() → docs
function fakeFind(docs) {
  mock.method(Contract, 'find', (filter) => ({
    select: () => ({ lean: async () => docs.filter((d) => filter._id.$in.includes(String(d._id))) }),
  }));
}

const running = { _id: A, title: 'vendor-a-2025', vendor: 'Vendor A', version: '2025', status: 'parsed', pageCount: 4, chunkCount: 0, processing: { stage: 'embedding', state: 'running', progress: { done: 20, total: 40 } } };
const failed = { _id: B, title: 'vendor-b-2025', vendor: 'Vendor B', version: '2025', status: 'chunked', pageCount: 4, chunkCount: 12, processing: { stage: 'embedding', state: 'failed', error: 'Gemini rate limit or quota reached.' } };

const getJson = async (path, init) => {
  const res = await fetch(base + path, init);
  return { status: res.status, body: await res.json() };
};

test('GET /contracts/status: several contracts in one request, deleted ones listed as missing', async () => {
  fakeFind([running, failed]);
  const gone = '64b7f0c2a1b2c3d4e5f60703';
  const { status, body } = await getJson(`/contracts/status?ids=${A},${B},${gone}`);
  assert.equal(status, 200);
  assert.deepEqual(body.contracts.map((c) => c._id), [A, B]);
  assert.deepEqual(body.missing, [gone]);
  const [a, b] = body.contracts;
  assert.equal(a.processing.active, true);
  assert.equal(a.processing.stage, 'embedding');
  assert.deepEqual(a.processing.progress, { done: 20, total: 40 });
  assert.ok(a.processing.percent > 0 && a.processing.percent < 100);
  assert.equal(b.processing.state, 'failed');
  assert.equal(b.processing.error, 'Gemini rate limit or quota reached.');
  assert.equal(b.processing.retryable, true);
  assert.equal(a.pages, undefined); // status responses never carry the page text
});

test('GET /contracts/status: validates the ids', async () => {
  assert.equal((await getJson('/contracts/status')).status, 400);
  const bad = await getJson('/contracts/status?ids=not-an-id');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /valid contract ids/);
  const many = Array.from({ length: 51 }, (_, i) => `64b7f0c2a1b2c3d4e5f6${String(i).padStart(4, '0')}`).join(',');
  assert.equal((await getJson(`/contracts/status?ids=${many}`)).status, 400);
});

test('GET /contracts/:id/status: 200 with the view, 404 when missing, 400 for a bad id', async () => {
  fakeFind([running]);
  const ok = await getJson(`/contracts/${A}/status`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.processing.label, 'Generating embeddings');
  assert.equal((await getJson(`/contracts/${B}/status`)).status, 404);
  assert.equal((await getJson('/contracts/xyz/status')).status, 400);
});

test('POST /contracts/:id/retry: refused (409) while the contract is still running', async () => {
  fakeFind([running]);
  const res = await getJson(`/contracts/${A}/retry`, { method: 'POST' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /running/);
  assert.equal(res.body.processing.active, true);
});

test('POST /contracts/upload: a fake PDF (right name, wrong bytes) is rejected with a clear reason', async () => {
  const form = new FormData();
  form.append('files', new Blob(['hello, I am not a pdf'], { type: 'application/pdf' }), 'contract.pdf');
  const res = await getJson('/contracts/upload', { method: 'POST', body: form });
  assert.equal(res.status, 422);
  assert.equal(res.body.results[0].ok, false);
  assert.match(res.body.results[0].error, /Not a valid PDF/);
});

test('POST /contracts/upload: too many files → readable 400', async () => {
  const form = new FormData();
  for (let i = 0; i < 11; i++) form.append('files', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), `c${i}.pdf`);
  const res = await getJson('/contracts/upload', { method: 'POST', body: form });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Upload at most 10 files at a time.');
});

test('POST /search: filters must be plain strings (no MongoDB operators)', async () => {
  const res = await getJson('/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'termination', vendor: { $ne: null } }),
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /must be strings/);
});

test('POST /ask: rejects a non-string question and invalid contract ids', async () => {
  const post = (body) => getJson('/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ question: { $gt: '' } })).status, 400);
  assert.equal((await post({ question: 'Notice?', contractIds: ['nope'] })).status, 400);
});
