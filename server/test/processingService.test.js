// The background pipeline, with MongoDB calls and AI steps replaced by fakes.
// Every write to contract.processing is recorded, so we can check exactly what
// the UI would have seen, in order.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import Contract from '../models/Contract.js';
import Chunk from '../models/Chunk.js';
import { runPipeline, recoverInterruptedJobs, retry, enqueue, failureMessage } from '../services/processingService.js';
import { INTERRUPTED_MESSAGE } from '../services/processingStatus.js';

const ID = '64b7f0c2a1b2c3d4e5f60718';
let writes; // every $set sent to Contract.updateOne
let exists;

beforeEach(() => {
  writes = [];
  exists = true;
  mock.method(Contract, 'updateOne', async (filter, update) => {
    writes.push(update.$set);
    return { acknowledged: true };
  });
  mock.method(Contract, 'exists', async () => (exists ? { _id: ID } : null));
  mock.method(Contract, 'findById', async () => ({ _id: ID, status: 'parsed', pageCount: 3, $locals: {} }));
  mock.method(Chunk, 'deleteMany', async () => ({ deletedCount: 3 }));
  mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
});
afterEach(() => mock.restoreAll());

// Fake chunk+embed step that reports stages like the real one
const goodProcess = async (contract, { onStage, onProgress }) => {
  await onStage('chunking');
  await onStage('embedding', { done: 0, total: 40 });
  await onProgress(20, 40);
  await onProgress(40, 40);
  await onStage('indexing');
  contract.status = 'embedded';
};
const goodAnalysis = async (contract) => {
  contract.status = 'analyzed';
};

const stagesSeen = () => writes.filter((w) => w['processing.stage']).map((w) => `${w['processing.stage']}:${w['processing.state']}`);
const last = () => writes.at(-1);

test('pipeline: success walks every stage in order and ends completed', async () => {
  await runPipeline(ID, { steps: { processContract: goodProcess, runAnalysis: goodAnalysis }, autoAnalyze: true });
  assert.deepEqual(stagesSeen(), [
    'chunking:running', 'embedding:running', 'indexing:running', 'analyzing:running', 'completed:completed',
  ]);
  // embedding progress was saved per batch, without changing the stage
  assert.deepEqual(writes.filter((w) => w['processing.progress']?.total === 40 && !w['processing.stage']).map((w) => w['processing.progress'].done), [20, 40]);
  assert.equal(last()['processing.analysisSkipped'], false);
  assert.equal(last()['processing.error'], null);
});

test('pipeline: with AUTO_ANALYZE off, analysis is skipped and recorded as skipped', async () => {
  await runPipeline(ID, { steps: { processContract: goodProcess, runAnalysis: () => assert.fail('must not analyse') }, autoAnalyze: false });
  assert.equal(last()['processing.state'], 'completed');
  assert.equal(last()['processing.analysisSkipped'], true);
});

test('pipeline: embedding failure (e.g. Gemini quota) fails at "embedding" with a readable message', async () => {
  const quotaProcess = async (contract, { onStage }) => {
    await onStage('chunking');
    await onStage('embedding', { done: 0, total: 10 });
    contract.status = 'chunked'; // the real step keeps the chunks but has no vectors
    contract.error = 'Embedding failed: 429 RESOURCE_EXHAUSTED';
    contract.$locals.embedError = Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { name: 'ApiError', status: 429 });
  };
  await runPipeline(ID, { steps: { processContract: quotaProcess, runAnalysis: goodAnalysis }, autoAnalyze: true });
  assert.equal(last()['processing.state'], 'failed');
  assert.equal(last()['processing.stage'], 'embedding');
  assert.match(last()['processing.error'], /rate limit or quota/);
  assert.ok(!stagesSeen().includes('indexing:running')); // never claimed to index
});

test('pipeline: analysis failure fails at "analyzing" (chunks stay searchable)', async () => {
  const badAnalysis = async () => {
    throw new Error('Contract too long to analyse in one pass (400000 chars).');
  };
  await runPipeline(ID, { steps: { processContract: goodProcess, runAnalysis: badAnalysis }, autoAnalyze: true });
  assert.equal(last()['processing.stage'], 'analyzing');
  assert.equal(last()['processing.state'], 'failed');
  assert.match(last()['processing.error'], /too long to analyse/);
});

test('pipeline: a step that tries to move backwards is rejected as an invalid state', async () => {
  const confused = async (contract, { onStage }) => {
    await onStage('indexing');
    await onStage('chunking'); // backwards
  };
  await runPipeline(ID, { steps: { processContract: confused, runAnalysis: goodAnalysis } });
  assert.equal(last()['processing.state'], 'failed');
  assert.match(last()['processing.error'], /Invalid processing transition: indexing → chunking/);
});

test('pipeline: "retry analysis" runs only the analysis step', async () => {
  let processed = false;
  await runPipeline(ID, { from: 'analyzing', steps: { processContract: async () => { processed = true; }, runAnalysis: goodAnalysis } });
  assert.equal(processed, false);
  assert.deepEqual(stagesSeen(), ['analyzing:running', 'completed:completed']);
});

test('pipeline: contract deleted while processing → its new chunks are removed, no failure written', async () => {
  const deletingProcess = async (contract, opts) => {
    await goodProcess(contract, opts);
    exists = false; // user pressed Delete meanwhile
  };
  await runPipeline(ID, { steps: { processContract: deletingProcess, runAnalysis: goodAnalysis }, autoAnalyze: false });
  assert.equal(Chunk.deleteMany.mock.callCount(), 1);
  assert.ok(!writes.some((w) => w['processing.state'] === 'completed' || w['processing.state'] === 'failed'));
});

test('pipeline: contract already gone when the job starts → nothing happens', async () => {
  Contract.findById.mock.mockImplementation(async () => null);
  await runPipeline(ID, { steps: { processContract: () => assert.fail(), runAnalysis: () => assert.fail() } });
  assert.equal(writes.length, 0);
});

test('startup recovery: queued/running jobs from a dead process become failed + retryable', async () => {
  mock.method(Contract, 'updateMany', async () => ({ modifiedCount: 2 }));
  assert.equal(await recoverInterruptedJobs(), 2);
  const [filter, update] = Contract.updateMany.mock.calls[0].arguments;
  assert.deepEqual(filter, { 'processing.state': { $in: ['queued', 'running'] } });
  assert.equal(update.$set['processing.state'], 'failed');
  assert.equal(update.$set['processing.error'], INTERRUPTED_MESSAGE);
});

test('retry: refused while running, and when another request already claimed the contract', async () => {
  const running = await retry({ _id: ID, status: 'parsed', pageCount: 3, processing: { stage: 'embedding', state: 'running' } });
  assert.equal(running.ok, false);
  assert.equal(running.status, 409);

  mock.method(Contract, 'findOneAndUpdate', () => ({ lean: async () => null })); // atomic claim lost
  const raced = await retry({ _id: '64b7f0c2a1b2c3d4e5f60799', status: 'chunked', pageCount: 3, processing: { stage: 'embedding', state: 'failed' } });
  assert.deepEqual([raced.ok, raced.status], [false, 409]);
});

test('retry: a failed analysis is claimed from "analyzing" and returns the queued status', async () => {
  const id = '64b7f0c2a1b2c3d4e5f60720';
  mock.method(Contract, 'findOneAndUpdate', (filter, update) => ({
    lean: async () => ({ _id: id, status: 'embedded', pageCount: 3, chunkCount: 9, processing: { stage: update.$set['processing.stage'], state: 'queued', attempts: 2 } }),
  }));
  Contract.findById.mock.mockImplementation(async () => null); // the background job then finds nothing to do
  const result = await retry({ _id: id, status: 'embedded', pageCount: 3, processing: { stage: 'analyzing', state: 'failed' } });
  assert.equal(result.ok, true);
  assert.equal(result.status, 202);
  assert.equal(result.contract.processing.stage, 'analyzing');
  assert.equal(result.contract.processing.active, true);
  const [filter] = Contract.findOneAndUpdate.mock.calls[0].arguments;
  assert.deepEqual(filter['processing.state'], { $nin: ['queued', 'running'] }); // can't double-start
  await new Promise((r) => setTimeout(r, 10)); // let the background job finish
});

test('runner: rejects unknown start stages', () => {
  assert.throws(() => enqueue('64b7f0c2a1b2c3d4e5f60730', { from: 'embedding' }), /Cannot start processing from "embedding"/);
});

test('failure messages: Gemini errors become actionable text, our own errors pass through', () => {
  assert.match(failureMessage(new Error('GEMINI_API_KEY is not set in server/.env')), /not configured/);
  assert.match(failureMessage(Object.assign(new Error('API key not valid'), { name: 'ApiError', status: 400 })), /rejected the API key/);
  assert.equal(failureMessage(new Error('No text could be split into chunks.')), 'No text could be split into chunks.');
  assert.match(failureMessage(Object.assign(new Error('E11000 duplicate key'), { name: 'MongoServerError' })), /Database error/);
});

test('pipeline (real chunk + embed code, sample PDF, no Gemini key): fails at "embedding", chunks still saved', async () => {
  const { extractPages } = await import('../services/pdfService.js');
  const fs = await import('node:fs');
  const { SAMPLES } = await import('./helpers.js');
  const { pages } = await extractPages(fs.readFileSync(`${SAMPLES}/vendor-a-2025.pdf`));
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const fake = { _id: ID, title: 'vendor-a-2025', vendor: 'Vendor A', version: '2025', status: 'parsed', pageCount: pages.length, pages, $locals: {}, save: async () => {} };
  Contract.findById.mock.mockImplementation(async () => fake);
  mock.method(Chunk, 'insertMany', async (docs) => docs);
  try {
    await runPipeline(ID, { autoAnalyze: true }); // real processContract / runAnalysis
  } finally {
    if (saved) process.env.GEMINI_API_KEY = saved;
  }
  assert.equal(fake.status, 'chunked');
  assert.ok(fake.chunkCount > 5, 'chunks were created from the sample PDF');
  assert.equal(Chunk.insertMany.mock.callCount(), 1); // kept for inspection
  assert.deepEqual(stagesSeen(), ['chunking:running', 'embedding:running', 'embedding:failed']);
  assert.match(last()['processing.error'], /GEMINI_API_KEY is not set/);
});
