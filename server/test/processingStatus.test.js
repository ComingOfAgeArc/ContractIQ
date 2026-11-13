import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE_KEYS, isValidTransition, assertTransition, describeProcessing, retryPlan, percentFor, legacyProcessing,
} from '../services/processingStatus.js';

const contract = (processing, extra = {}) => ({ status: 'parsed', pageCount: 5, processing, ...extra });
const statuses = (view) => Object.fromEntries(view.stages.map((s) => [s.key, s.status]));

test('status: the seven stages are in pipeline order', () => {
  assert.deepEqual(STAGE_KEYS, ['uploaded', 'parsing', 'chunking', 'embedding', 'indexing', 'analyzing', 'completed']);
});

test('status transitions: forwards (and skipping analysis) allowed; backwards, repeats and unknown stages rejected', () => {
  assert.equal(isValidTransition('chunking', 'embedding'), true);
  assert.equal(isValidTransition('indexing', 'completed'), true); // AUTO_ANALYZE=off skips analysing
  assert.equal(isValidTransition('analyzing', 'embedding'), false);
  assert.equal(isValidTransition('embedding', 'embedding'), false);
  assert.equal(isValidTransition('completed', 'chunking'), false);
  assert.equal(isValidTransition('chunking', 'teleporting'), false);
  assert.throws(() => assertTransition('indexing', 'chunking'), /Invalid processing transition: indexing → chunking/);
});

test('status view: queued contract shows upload + text extraction done, nothing running yet', () => {
  const v = describeProcessing(contract({ stage: 'chunking', state: 'queued' }));
  assert.equal(v.active, true);
  assert.deepEqual(statuses(v), {
    uploaded: 'done', parsing: 'done', chunking: 'queued', embedding: 'pending', indexing: 'pending', analyzing: 'pending', completed: 'pending',
  });
  assert.equal(v.percent, 15);
  assert.equal(v.retryable, false); // never retry something that is still queued
});

test('status view: embedding progress moves the bar inside the stage', () => {
  const half = describeProcessing(contract({ stage: 'embedding', state: 'running', progress: { done: 10, total: 20 } }));
  assert.equal(statuses(half).embedding, 'active');
  assert.deepEqual(half.progress, { done: 10, total: 20 });
  assert.equal(half.percent, 20 + 18); // stages before = 5+10+5, half of 35
});

test('status view: never shows 100% before the pipeline has really finished', () => {
  // last stage, progress reported as complete, but state is still running
  const p = { stage: 'analyzing', state: 'running', progress: { done: 5, total: 5 } };
  assert.ok(percentFor(p) < 100);
  assert.ok(describeProcessing(contract(p)).percent <= 99);
  assert.equal(describeProcessing(contract({ stage: 'completed', state: 'completed' })).percent, 100);
});

test('status view: failure marks the failed stage, keeps the readable error and offers a safe retry', () => {
  const v = describeProcessing(contract({ stage: 'embedding', state: 'failed', error: 'Gemini rate limit or quota reached.' }));
  assert.equal(v.active, false);
  assert.equal(statuses(v).embedding, 'failed');
  assert.equal(statuses(v).chunking, 'done');
  assert.equal(statuses(v).indexing, 'pending');
  assert.equal(v.error, 'Gemini rate limit or quota reached.');
  assert.equal(v.retryable, true);
  assert.equal(v.retryFrom, 'chunking');
});

test('status view: completed with analysis turned off shows the analysis stage as skipped', () => {
  const v = describeProcessing(contract({ stage: 'completed', state: 'completed', analysisSkipped: true }, { status: 'embedded' }));
  assert.equal(statuses(v).analyzing, 'skipped');
  assert.equal(statuses(v).completed, 'done');
});

test('retry plan: analysis failures retry only the analysis; earlier failures redo chunk + embed', () => {
  const analysisFailed = contract({ stage: 'analyzing', state: 'failed' }, { status: 'embedded' });
  assert.deepEqual(retryPlan(analysisFailed), { retryable: true, from: 'analyzing' });
  const indexingFailed = contract({ stage: 'indexing', state: 'failed' }, { status: 'chunked' });
  assert.deepEqual(retryPlan(indexingFailed), { retryable: true, from: 'chunking' });
});

test('retry plan: not allowed while running, after success, or without extracted text', () => {
  assert.equal(retryPlan(contract({ stage: 'embedding', state: 'running' })).retryable, false);
  assert.equal(retryPlan(contract({ stage: 'completed', state: 'completed' })).retryable, false);
  const noText = retryPlan(contract({ stage: 'chunking', state: 'failed' }, { pageCount: 0 }));
  assert.equal(noText.retryable, false);
  assert.match(noText.reason, /upload the PDF again/);
});

test('legacy contracts (uploaded before the tracker existed) get a sensible status', () => {
  assert.equal(legacyProcessing({ status: 'analyzed' }).state, 'completed');
  assert.deepEqual(legacyProcessing({ status: 'chunked', error: 'Embedding failed: x' }), { stage: 'embedding', state: 'failed', error: 'Embedding failed: x' });
  const parsedOnly = describeProcessing({ status: 'parsed', pageCount: 3 });
  assert.equal(parsedOnly.state, 'failed');
  assert.equal(parsedOnly.retryable, true); // the old "Process" button is now "Retry"
});
